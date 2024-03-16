import type { Driver, NextPluginCallback } from '@appium/base-plugin';
import { BasePlugin } from '@appium/base-plugin';
import { logger } from '@appium/support';
import { asyncExitHook } from 'exit-hook';
import type { Application } from 'express';
import crypto from 'node:crypto';
import { IncomingMessage } from 'node:http';
import os from 'node:os';
import supertest from 'supertest';
import zmq from 'zeromq';

export class GridPlugin extends BasePlugin {
  private static logger = logger.getLogger('Grid');
  private static publisherSocket: zmq.Publisher;
  private static registrationSecret: string;
  private static sessionsIds = new Set<string>();
  private static status: any;

  static {
    /**
     * Workaround for Appium that drop connections when an
     * upgrade request with a non-websocket protocol is received.
     *
     * https://github.com/appium/appium/blob/47765747b66c5e0076f6ffe4619d6b98a42aee29/packages/base-driver/lib/express/websocket.js#L32
     */
    Object.defineProperty(IncomingMessage.prototype, 'upgrade', {
      set() {},
      get() {
        return (
          'connection' in this.headers &&
          'upgrade' in this.headers &&
          this.headers.connection.startsWith('Upgrade') &&
          this.headers.upgrade.toLowerCase() == 'websocket'
        );
      },
    });

    asyncExitHook(
      async () => {
        GridPlugin.status.availability = 'DOWN';
        await GridPlugin.publisherSocket.send([
          'node-status',
          JSON.stringify(GridPlugin.registrationSecret),
          crypto.randomUUID(),
          JSON.stringify(GridPlugin.status),
        ]);
      },
      {
        wait: 500,
      }
    );
  }

  static async updateServer(app: Application, _server: unknown, args: any) {
    const nodeId = crypto.randomUUID();
    const stereotype = JSON.parse(args.plugin.grid.stereotype);
    const externalUri = args.plugin.grid.externalUrl;
    const publishEventsAddress = args.plugin.grid.publishEvents;
    const registrationSecret = args.plugin.grid.registrationSecret;
    const basePath = args.basePath;

    app.post(`${basePath}/se/grid/node/session`, async (req, res) => {
      const response = await supertest(req.app)
        .post(`${basePath}/session`)
        .send({
          capabilities: {
            firstMatch: [],
            alwaysMatch: req.body.desiredCapabilities,
          },
        });

      if (!response.ok) {
        res.status(response.status).send(response.text);
        return;
      }

      const result = JSON.parse(response.text)?.value;
      const sessionId = result?.sessionId;
      const capabilities = result?.capabilities;
      GridPlugin.sessionsIds.add(sessionId);

      res.status(200).json({
        value: {
          sessionResponse: {
            downstreamEncodedResponse: Buffer.from(
              JSON.stringify({
                value: {
                  sessionId,
                  capabilities,
                },
              })
            ).toString('base64'),
            session: {
              capabilities,
              sessionId,
              start: new Date().toISOString(),
              stereotype: GridPlugin.status.slots[0]!.stereotype,
              uri: GridPlugin.status.externalUri,
            },
          },
        },
      });
    });

    GridPlugin.registrationSecret = registrationSecret;
    GridPlugin.status = {
      nodeId,
      version: 'unknown',
      osInfo: {
        arch: os.arch(),
        name: os.platform(),
        version: os.release(),
      },

      availability: 'UP',
      externalUri: externalUri,
      heartbeatPeriod: 60_000,
      maxSessions: 1,

      slots: (Array.isArray(stereotype) ? stereotype : [stereotype]).map(
        (stereotype: Record<string, unknown>) => ({
          id: { hostId: nodeId, id: crypto.randomUUID() },
          lastStarted: new Date(0).toISOString(),
          stereotype,
          session: null,
        })
      ),
    };

    GridPlugin.logger.info(`Connecting to ${publishEventsAddress}`);

    const publisherSocket = (GridPlugin.publisherSocket = new zmq.Publisher());
    publisherSocket.connect(publishEventsAddress);
    publisherSocket.events.on('connect', () => {
      setTimeout(() => {
        GridPlugin.logger.info(
          `Reporting self as ${externalUri} to ${publishEventsAddress}`
        );

        publisherSocket
          .send([
            'node-status',
            JSON.stringify(GridPlugin.registrationSecret),
            crypto.randomUUID(),
            JSON.stringify(GridPlugin.status),
          ])
          .catch((error) => {
            GridPlugin.logger.error(error);
          });
      }, 5e3);
    });
  }

  async getStatus(next: NextPluginCallback, driver: Driver<{}>) {
    const sessions = await driver.getSessions();
    const sessionIds = new Set(sessions.map((session) => session.id));

    GridPlugin.sessionsIds.forEach((sessionId) => {
      if (!sessionIds.has(sessionId)) {
        GridPlugin.sessionsIds.delete(sessionId);
        GridPlugin.publisherSocket.send([
          'session-closed',
          JSON.stringify(GridPlugin.registrationSecret),
          crypto.randomUUID(),
          JSON.stringify(sessionId),
        ]);
      }
    });

    return Object.assign({}, await next(), { node: GridPlugin.status });
  }

  async deleteSession(next: NextPluginCallback, _: unknown, id: string) {
    try {
      return next();
    } finally {
      if (GridPlugin.sessionsIds.delete(id)) {
        GridPlugin.publisherSocket.send([
          'session-closed',
          JSON.stringify(GridPlugin.registrationSecret),
          crypto.randomUUID(),
          JSON.stringify(id),
        ]);
      }
    }
  }
}

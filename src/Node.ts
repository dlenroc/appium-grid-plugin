import { logger } from '@appium/support';
import { asyncExitHook, gracefulExit } from 'exit-hook';
import type { Application } from 'express';
import isMatch from 'lodash.ismatch';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import supertest from 'supertest';
import si from 'systeminformation';
import zmq from 'zeromq';
import { Availability } from './types/Availability.js';
import type { NodeStatus } from './types/NodeStatus.js';
import type { Session } from './types/Session.js';

const osInfo = await si.osInfo();

export class Node {
  private logger = logger.getLogger('Node');
  private pendingSlots = new Set<string>();
  private publisherSocket = new zmq.Publisher();
  private status: NodeStatus;

  constructor(
    app: Application,
    options: {
      prefix: string;
      externalUri: string;
      publishEvents: string;
      stereotypes: Record<string, unknown>[];
      heartbeatPeriod: number;
      sessionTimeout: number;
    }
  ) {
    const nodeId = crypto.randomUUID();

    this.status = {
      nodeId,
      externalUri: options.externalUri,
      maxSessions: options.stereotypes.length,
      slots: options.stereotypes.map((stereotype) => ({
        id: { hostId: nodeId, id: crypto.randomUUID() },
        lastStarted: new Date(0).toISOString(),
        session: null,
        stereotype,
      })),
      availability: Availability.UP,
      heartbeatPeriod: options.heartbeatPeriod,
      sessionTimeout: options.sessionTimeout,
      version: 'unknown',
      osInfo: {
        arch: osInfo.arch,
        name: osInfo.codename ?? osInfo.platform,
        version: osInfo.release,
      },
    };

    app
      .get('/se/grid/node/owner/:sessionId', (req, res) => {
        const isOwned = this.isSessionOwner(req.params.sessionId);
        res.status(200).json({ value: isOwned });
      })
      .post('/se/grid/node/connection/:sessionId', (req, res) => {
        const canAcquire = this.tryAcquireConnection(req.params.sessionId);
        res.status(200).json({ value: canAcquire });
      })
      .post('/se/grid/node/session', (req, res) => {
        if (this.status.availability === Availability.DRAINING) {
          this.logger.info('Node is draining');
          res.status(200).json({
            value: {
              exception: {
                error: 'org.openqa.selenium.RetrySessionRequestException',
                message: 'The node is draining. Cannot accept new sessions.',
              },
            },
          });

          return;
        }

        const desiredCapabilities = req.body.desiredCapabilities;
        const matchedSlots = this.status.slots.filter((it) =>
          isMatch(desiredCapabilities, it.stereotype)
        );
        const availableSlot = matchedSlots.find(
          (it) => !it.session && !this.pendingSlots.has(it.id.id)
        );
        if (!availableSlot) {
          if (matchedSlots.length) {
            this.logger.info('Matching slots are busy');
            res.status(200).json({
              value: {
                exception: {
                  error: 'org.openqa.selenium.RetrySessionRequestException',
                  message: 'Slot is busy. Try another slot.',
                },
              },
            });
          } else {
            this.logger.info('No matching slots available');
            res.status(500).json({
              error: 'session not created',
              message: `No slot available for desired capabilities: ${JSON.stringify(
                desiredCapabilities
              )}`,
              stacktrace: '',
            });
          }

          return;
        }

        this.pendingSlots.add(availableSlot.id.id);

        (async () => {
          try {
            const response = await supertest(req.app)
              .post(`${options.prefix}/session`)
              .send({
                capabilities: {
                  firstMatch: [{}],
                  alwaysMatch: req.body.desiredCapabilities,
                },
              });

            if (!response.ok) {
              this.pendingSlots.delete(availableSlot.id.id);

              res
                .status(response.status)
                .set(response.headers)
                .json(response.body);

              return;
            }

            res.status(200).json({
              value: {
                sessionResponse: {
                  downstreamEncodedResponse: Buffer.from(
                    JSON.stringify(response.body)
                  ).toString('base64'),
                  session: (availableSlot.session = {
                    capabilities: response.body.value.capabilities,
                    sessionId: response.body.value.sessionId,
                    start: (availableSlot.lastStarted =
                      new Date().toISOString()),
                    stereotype: availableSlot.stereotype,
                    uri: options.externalUri,
                  }),
                },
              },
            });
          } catch (error) {
            this.pendingSlots.delete(availableSlot.id.id);
            res.status(500).json({
              error: 'session not created',
              message: error instanceof Error ? error.message : String(error),
              stacktrace: error instanceof Error ? error.stack ?? '' : '',
            });
          }
        })();
      })
      .delete('/se/grid/node/session/:sessionId', (req, res) => {
        supertest(req.app)
          .delete(`${options.prefix}/session/${req.params.sessionId}`)
          .then((response) =>
            res
              .status(response.status)
              .set(response.headers)
              .json(response.body)
          )
          .catch((error) => {
            res.status(500).json({
              error: 'org.openqa.selenium.WebDriverException',
              message: error instanceof Error ? error.message : String(error),
              stacktrace: '',
            });
          });
      })
      .get('/se/grid/node/session/:sessionId', (req, res) => {
        const id = req.params.sessionId;
        const session = this.getSession(id);
        if (session) {
          res.status(200).json({ value: session });
        } else {
          res.status(404).json({
            error: 'invalid session id',
            message: `Cannot find session with id: ${id}`,
            stacktrace: '',
          });
        }
      })
      .post('/se/grid/node/drain', async (_, res) => {
        await this.drain().catch((error) => this.logger.error(error));
        res.status(200).end();
      })
      .get('/se/grid/node/status', (_, res) => {
        res.status(200).json(this.getStatus());
      });

    const sendNodeHeartbeat = () => {
      this.publisherSocket
        .send([
          'node-heartbeat',
          '""',
          crypto.randomUUID(),
          JSON.stringify(this.getStatus()),
        ])
        .catch((error) => this.logger.error(error));
    };

    this.logger.info(`Connecting to ${options.publishEvents}`);
    this.publisherSocket.connect(options.publishEvents);
    this.publisherSocket.events.on('connect', () => {
      this.logger.info(
        `Reporting self as ${options.externalUri} to ${options.publishEvents}`
      );
      sendNodeHeartbeat();
    });

    setInterval(() => sendNodeHeartbeat(), options.heartbeatPeriod);
    asyncExitHook(() => this.drain(true), { wait: 10_000 });
  }

  public isSessionOwner(id: string): boolean {
    return this.status.slots.some((slot) => slot.session?.sessionId === id);
  }

  public tryAcquireConnection(_id: string): boolean {
    return false;
  }

  public getSession(id: string): Session | null {
    return (
      this.status.slots.find((slot) => slot.session?.sessionId === id)
        ?.session ?? null
    );
  }

  public async deleteSession(id: string): Promise<void> {
    for (const slot of this.status.slots) {
      if (slot.session?.sessionId === id) {
        this.logger.info(`Closing session ${id} from slot ${slot.id.id}`);

        slot.session = null;
        this.pendingSlots.delete(slot.id.id);
        await this.publisherSocket
          .send([
            'session-closed',
            '""',
            crypto.randomUUID(),
            JSON.stringify(id),
          ])
          .catch((error) => this.logger.error(error));

        break;
      }
    }

    if (this.status.availability === Availability.DRAINING) {
      await this.drain();
    }
  }

  public async drain(force: boolean = false): Promise<void> {
    const nodeId = this.status.nodeId;

    if (this.status.availability !== Availability.DRAINING) {
      this.status.availability = Availability.DRAINING;
      await this.publisherSocket
        .send([
          'node-drain-started',
          '""',
          crypto.randomUUID(),
          JSON.stringify(nodeId),
        ])
        .catch((error) => this.logger.error(error));
    }

    if (force || this.pendingSlots.size === 0) {
      await this.publisherSocket
        .send([
          'node-drain-complete',
          '""',
          crypto.randomUUID(),
          JSON.stringify(nodeId),
        ])
        .catch((error) => this.logger.error(error));

      gracefulExit();
    }
  }

  public getStatus() {
    return this.status;
  }
}

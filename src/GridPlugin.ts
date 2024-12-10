import type { Constraints, Driver } from '@appium/base-plugin';
import { BasePlugin } from '@appium/base-plugin';
import type { Application } from 'express';
import { Node } from './Node.js';

export class GridPlugin extends BasePlugin {
  private static node: Node;

  static updateServer(app: Application, _: unknown, args: any) {
    const prefix = args.basePath;
    const externalUri = args.plugin.grid.externalUrl;
    const heartbeatPeriod = args.plugin.grid.heartbeatPeriod;
    const sessionTimeout = args.plugin.grid.sessionTimeout;
    const publishEvents = args.plugin.grid.publishEvents;
    const stereotypes = Array.isArray(args.plugin.grid.stereotype)
      ? args.plugin.grid.stereotype.length
        ? args.plugin.grid.stereotype
        : [{}]
      : [args.plugin.grid.stereotype ?? {}];

    GridPlugin.node = new Node(app, {
      prefix,
      externalUri,
      publishEvents,
      stereotypes,
      heartbeatPeriod,
      sessionTimeout,
    });
  }

  async getStatus(next: () => Promise<Record<string, unknown>>) {
    return {
      ...(await next()),
      node: GridPlugin.node.getStatus(),
    };
  }

  async deleteSession(next: () => unknown, _: unknown, sessionId: string) {
    try {
      return await next();
    } finally {
      await GridPlugin.node.deleteSession(sessionId);
    }
  }

  async onUnexpectedShutdown(driver: Driver<Constraints>) {
    if (driver.sessionId) {
      await GridPlugin.node.deleteSession(driver.sessionId);
    }
  }
}

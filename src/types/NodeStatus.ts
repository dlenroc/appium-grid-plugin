import type { Availability } from './Availability.js';
import type { Slot } from './Slot.js';

export type NodeStatus = {
  nodeId: string;
  externalUri: string;
  maxSessions: number;
  slots: Slot[];
  availability: Availability;
  heartbeatPeriod: number;
  sessionTimeout: number;
  version: string;
  osInfo: {
    arch: string;
    name: string;
    version: string;
  };
};

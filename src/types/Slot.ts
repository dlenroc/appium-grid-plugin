import type { Session } from './Session.js';

export type Slot = {
  id: { hostId: string; id: string };
  lastStarted: string;
  session: Session | null;
  stereotype: Record<string, unknown>;
};

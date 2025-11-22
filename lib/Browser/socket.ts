import { createSocketPair } from "automated-gameplay-transmitter";
import type { Locator } from "playwright";

export type State =
  | {
    name: 'initialized'
  }
  | {
    name: 'opened'
    url: string
  }
  | {
    name: 'closed'
  }
  | {
    name: 'clicked'
    id: string
    succeeded: boolean
  }
  | {
    name: 'idle'
    url: string
    state?: unknown
  };

export type Action =
  | {
    name: 'noop'
  }
  | {
    name: 'open'
    url: string
  }
  | {
    name: 'click'
    target: string
    id: string
  };

export const {
  sender: createSender,
  receiver: createReceiver,
} = createSocketPair<State, Action>(
  (process.platform === 'win32' ? '' : '\0') + 'var/unix.sock',
);

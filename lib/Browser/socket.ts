import { createSocketPair } from "automated-gameplay-transmitter";

export type State =
  | {
    name: 'initialized'
  }
  | {
    name: 'idle'
    url: string
  }
  | {
    name: 'closed'
  };

export type Action =
  | {
    name: 'noop'
  }
  | {
    name: 'open'
    url: string
  };

export const {
  sender: createSender,
  receiver: createReceiver,
} = createSocketPair<State, Action>(
  (process.platform === 'win32' ? '' : '\0') + 'var/unix.sock',
);

import { createSocketPair } from "automated-gameplay-transmitter";

type State =
  | {
    name: 'initialized'
  }
  | {
    name: 'idle'
  }
  | {
    name: 'closed'
  };

type Action =
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

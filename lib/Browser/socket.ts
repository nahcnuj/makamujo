import { createSocketPair } from "automated-gameplay-transmitter";

export type State =
  | {
    name: 'initialized'
  }
  | {
    name: 'closed'
  }
  | {
    name: 'idle'
    url: string
    state?: unknown
  }
  | {
    name: 'result'
    action: Action
    succeeded: boolean
  }

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
    datetime: number
  }

export const {
  sender: createSender,
  receiver: createReceiver,
} = createSocketPair<State, Action>(
  (process.platform === 'win32' ? '' : '\0') + 'var/unix.sock',
);

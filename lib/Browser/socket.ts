import { createSocketPair } from "automated-gameplay-transmitter";
import type { GameName } from "../Agent/games";

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
    succeeded: boolean
    action: Action
  }

export const ok = (action: Action): State => ({
  name: 'result',
  succeeded: true,
  action,
});

export const error = (action: Action): State => ({
  name: 'result',
  succeeded: false,
  action,
});

export type Action =
  | {
    name: 'noop'
    game?: GameName
  }
  | {
    name: 'open'
    url: string
  }
  | {
    name: 'click'
    target: 
      | {
        type: 'text'
        text: string
      }
  }
  | {
    name: 'press'
    key: string
    on?: {
      selector: string
    }
  }
  | {
    name: 'fill'
    value: string
    on: {
      selector: string
      role: string
    }
  }

export const {
  sender: createSender,
  receiver: createReceiver,
} = createSocketPair<State, Action>(
  (process.platform === 'win32' ? '' : '\0') + 'var/unix.sock',
);

import { createSocketPair } from "automated-gameplay-transmitter";

type State = {
  name: 'waiting'
};

type Action = {
  name: 'noop'
};

export const {
  sender: createSender,
  receiver: createReceiver,
} = createSocketPair<State, Action>(
  (process.platform === 'win32' ? '' : '\0') + 'var/unix.sock',
);

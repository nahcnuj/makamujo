import { createSocketPair } from "automated-gameplay-transmitter";

const path = (process.platform === 'win32' ? '' : '\0') + 'var/unix.sock';

export const {
  sender: createSender,
  receiver: createReceiver,
} = createSocketPair(path);

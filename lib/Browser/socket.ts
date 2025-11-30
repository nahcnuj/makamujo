import { Action, createReceiver as receiver, createSender as sender, type State } from "automated-gameplay-transmitter";

const path = (process.platform === 'win32' ? '' : '\0') + 'var/unix.sock';

export const createSender = sender<State, Action.Action>(path);
export const createReceiver = receiver<State, Action.Action>(path);

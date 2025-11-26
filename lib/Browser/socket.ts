import { createReceiver as receiver, createSender as sender } from "automated-gameplay-transmitter";
import type { Action } from "./Action";
import type { State } from "./State";

const path = (process.platform === 'win32' ? '' : '\0') + 'var/unix.sock';

export const createSender = sender<State, Action>(path);
export const createReceiver = receiver<State, Action>(path);

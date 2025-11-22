import { createSocketPair } from "automated-gameplay-transmitter";
import type { Action } from "./Action";
import { solve } from "./solver";
import type { State } from "./State";

const path = (process.platform === 'win32' ? '' : '\0') + 'var/cookieclicker.sock';

const { receiver, sender } = createSocketPair<State, Action>(path);

export const solver = () => receiver(solve);

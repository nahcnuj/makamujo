import { createSocket } from "../../../Socket";
import type { Action } from "./Action";
import { solve } from "./solver";
import type { State } from "./State";

const path = (process.platform === 'win32' ? '' : '\0') + 'var/cookiecliker.sock';

const { receiver, sender } = createSocket<State, Action>(path);

export const solver = () => receiver(solve);
// export const send = (state: State) => 
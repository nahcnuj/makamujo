import { Action, type State } from "automated-gameplay-transmitter";
import { createReceiver as receiver, createSender as sender } from "automated-gameplay-transmitter/server";

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const unixSocketDir = join(process.cwd(), "var");
if (!existsSync(unixSocketDir)) {
  mkdirSync(unixSocketDir, { recursive: true });
}

const socketPath = process.platform === "win32"
  ? "\\\\.\\pipe\\makamujo-ipc"
  : join(unixSocketDir, "unix.sock");

export const createSender = sender<State, Action.Action>(socketPath);
export const createReceiver = receiver<State, Action.Action>(socketPath);

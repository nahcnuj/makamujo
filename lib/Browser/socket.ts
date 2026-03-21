import { Action, type State } from "automated-gameplay-transmitter";
import { createReceiver as receiver, createSender as sender } from "automated-gameplay-transmitter/server";

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const unixSocketDir = join(process.cwd(), "var");
if (!existsSync(unixSocketDir)) {
  mkdirSync(unixSocketDir, { recursive: true });
}

export const defaultSocketPath = process.platform === "win32"
  ? "\\\\.\\pipe\\makamujo-ipc"
  : join(unixSocketDir, "unix.sock");

export const createSender = sender<State, Action.Action>(defaultSocketPath);
export const createReceiver = receiver<State, Action.Action>(defaultSocketPath);

export const createSenderWithPath = (path: string) => sender<State, Action.Action>(path);
export const createReceiverWithPath = (path: string) => receiver<State, Action.Action>(path);

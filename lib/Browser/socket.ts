import { Action, type State } from "automated-gameplay-transmitter";
import { createReceiver as receiver, createSender as sender } from "automated-gameplay-transmitter/server";

import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import type { Socket } from "node:net";
import { join } from "node:path";

const unixSocketDir = join(process.cwd(), "var");
if (!existsSync(unixSocketDir)) {
  mkdirSync(unixSocketDir, { recursive: true });
}

export const defaultSocketPath = process.env.MAKAMUJO_IPC_PATH
  ?? (process.platform === "win32"
    ? '\\\\.\\pipe\\makamujo-ipc'
    : join(unixSocketDir, "unix.sock"));

export const createSender = sender<State, Action.Action>(defaultSocketPath);
export const createSenderWithPath = (path: string) => sender<State, Action.Action>(path);

/**
 * Removes a stale Unix socket file so that the next `server.listen()` call
 * succeeds even when the previous process exited without cleaning up.
 * On Windows named pipes do not leave a file on disk, so this is a no-op.
 */
const removeStaleSocketFile = (path: string) => {
  if (process.platform !== "win32" && existsSync(path)) {
    try {
      unlinkSync(path);
    } catch { /* best-effort */ }
  }
};

const rawCreateReceiver = receiver<State, Action.Action>(defaultSocketPath);
/**
 * Starts the IPC receiver on the default socket path, removing any stale
 * socket file left by a previous process first so that `server.listen()`
 * does not throw EADDRINUSE.
 */
export const createReceiver = (solve: (state: State) => Action.Action) => {
  removeStaleSocketFile(defaultSocketPath);
  return rawCreateReceiver(solve);
};

export const createReceiverWithPath = (path: string) => {
  const fn = receiver<State, Action.Action>(path);
  return (solve: (state: State) => Action.Action) => {
    removeStaleSocketFile(path);
    return fn(solve);
  };
};

/**
 * Creates a sender that automatically retries the connection on failure and
 * reconnects if the connection is lost.
 *
 * @param path - The socket path to connect to.
 * @param retryDelayMs - Milliseconds to wait before retrying a failed connection.
 * @returns A curried function matching the `sender` API.
 *          Pass an action handler and an optional `onConnect` callback that is
 *          invoked each time a connection is (re-)established.  Use `onConnect`
 *          to re-send the initial state so the server can restart the
 *          interaction after a reconnect.
 */
export const createRetrySenderWithPath = (path: string, retryDelayMs: number = 1000) =>
  async (
    run: (action: Action.Action) => Promise<void>,
    onConnect?: (send: (state: State) => void) => void,
  ): Promise<(state: State) => void> => {
    const { createConnection } = await import("node:net");

    let currentConn: Socket | null = null;
    let running = false;

    const doSend = (state: State) => {
      if (currentConn?.writable) {
        try {
          currentConn.write(JSON.stringify(state, null, 0));
        } catch (err) {
          console.warn("[WARN]", "socket write failed", path, err);
        }
      }
    };

    const connect = async (): Promise<void> => {
      while (true) {
        const conn = createConnection(path);

        const result = await new Promise<"connected" | "failed">((resolve) => {
          conn.once("connect", () => resolve("connected"));
          conn.once("error", () => {
            conn.destroy();
            resolve("failed");
          });
        });

        if (result === "connected") {
          currentConn = conn;

          conn.on("close", () => {
            if (currentConn === conn) {
              currentConn = null;
            }
            connect().catch((err) => {
              console.warn("[WARN]", "reconnection failed", path, err);
            });
          });

          conn.on("error", (err) => {
            console.warn("[WARN]", "socket error", path, err.message ?? String(err));
            if (currentConn === conn) {
              currentConn = null;
            }
          });

          conn.on("data", async (buf) => {
            if (running) return;
            const action = JSON.parse(buf.toString()) as Action.Action | null;
            if (!action) return;
            running = true;
            try {
              await run(action);
            } catch (err) {
              console.warn("[WARN]", "error during action", err instanceof Error ? err.message : String(err));
            } finally {
              running = false;
            }
          });

          onConnect?.(doSend);
          return;
        }

        // Connection failed — wait before retrying.
        await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
      }
    };

    await connect();
    return doSend;
  };

export const createRetrySender = createRetrySenderWithPath(defaultSocketPath);

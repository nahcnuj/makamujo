import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import type { Socket } from "node:net";
import { basename, join, resolve, sep } from "node:path";
import type { Action, State } from "automated-gameplay-transmitter";
import {
  createReceiver as receiver,
  createSender as sender,
} from "automated-gameplay-transmitter/server";

const unixSocketDir = join(process.cwd(), "var");
if (!existsSync(unixSocketDir)) {
  mkdirSync(unixSocketDir, { recursive: true });
}

/** Socket file names allowed under `var/` (no separators / traversal). */
const IPC_SOCKET_BASENAME = /^[\w.-]+\.sock$/;

const isWindowsNamedPipe = (path: string): boolean =>
  process.platform === "win32" && /^\\\\\.\\pipe\\[A-Za-z0-9._-]+$/.test(path);

/**
 * Rebuild an IPC path as `var/<basename>` so FS APIs never see the raw
 * user/env string. Returns undefined when the basename is not an allowlisted
 * `*.sock` name.
 */
const rebuildIpcPathUnderVar = (path: string): string | undefined => {
  if (!path || path.includes("\0")) return undefined;
  const base = basename(path);
  if (!IPC_SOCKET_BASENAME.test(base)) return undefined;
  const rootPrefix = `${resolve(unixSocketDir)}${sep}`;
  const filePath = resolve(unixSocketDir, base);
  // Positive startsWith branch is the CodeQL containment barrier.
  if (filePath.startsWith(rootPrefix)) {
    return filePath;
  }
  return undefined;
};

const assertSafeIpcPath = (path: string): string => {
  if (isWindowsNamedPipe(path)) return path;
  const safePath = rebuildIpcPathUnderVar(path);
  if (!safePath) {
    throw new Error(`Unsafe IPC path: ${path}`);
  }
  return safePath;
};

const resolveDefaultSocketPath = (): string => {
  const fromEnv = process.env.MAKAMUJO_IPC_PATH;
  if (fromEnv) {
    if (isWindowsNamedPipe(fromEnv)) return fromEnv;
    const safePath = rebuildIpcPathUnderVar(fromEnv);
    if (safePath) return safePath;
    console.warn(
      "[WARN] Ignoring MAKAMUJO_IPC_PATH outside project var/:",
      fromEnv,
    );
  }
  return process.platform === "win32"
    ? "\\\\.\\pipe\\makamujo-ipc"
    : join(unixSocketDir, "unix.sock");
};

export const defaultSocketPath = resolveDefaultSocketPath();

export const createSender = sender<State, Action.Action>(defaultSocketPath);
export const createSenderWithPath = (path: string) =>
  sender<State, Action.Action>(assertSafeIpcPath(path));

/**
 * Removes a stale Unix socket file so that the next `server.listen()` call
 * succeeds even when the previous process exited without cleaning up.
 * On Windows named pipes do not leave a file on disk, so this is a no-op.
 *
 * Rebuilds `var/<basename>` from a fixed root; FS ops run only inside a
 * positive `startsWith(varPrefix)` branch (CodeQL path-injection barrier).
 */
export const removeStaleUnixIpcSocket = (path: string): void => {
  if (process.platform === "win32" || !path || path.includes("\0")) return;
  const base = basename(path);
  if (!IPC_SOCKET_BASENAME.test(base)) return;

  const rootPrefix = `${resolve(unixSocketDir)}${sep}`;
  const filePath = resolve(unixSocketDir, base);
  if (filePath.startsWith(rootPrefix)) {
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {
        /* best-effort */
      }
    }
  }
};

const rawCreateReceiver = receiver<State, Action.Action>(defaultSocketPath);
/**
 * Starts the IPC receiver on the default socket path, removing any stale
 * socket file left by a previous process first so that `server.listen()`
 * does not throw EADDRINUSE.
 */
export const createReceiver = (solve: (state: State) => Action.Action) => {
  removeStaleUnixIpcSocket(defaultSocketPath);
  return rawCreateReceiver(solve);
};

export const createReceiverWithPath = (path: string) => {
  const safePath = assertSafeIpcPath(path);
  const fn = receiver<State, Action.Action>(safePath);
  return (solve: (state: State) => Action.Action) => {
    removeStaleUnixIpcSocket(safePath);
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
export const createRetrySenderWithPath =
  (path: string, retryDelayMs: number = 1000) =>
  async (
    run: (action: Action.Action) => Promise<void>,
    onConnect?: (send: (state: State) => void) => void,
  ): Promise<(state: State) => void> => {
    const safePath = assertSafeIpcPath(path);
    const { createConnection } = await import("node:net");

    let currentConn: Socket | null = null;
    let running = false;

    const doSend = (state: State) => {
      if (currentConn?.writable) {
        try {
          currentConn.write(JSON.stringify(state, null, 0));
        } catch (err) {
          console.warn("[WARN]", "socket write failed", safePath, err);
        }
      }
    };

    const connect = async (): Promise<void> => {
      while (true) {
        const conn = createConnection(safePath);

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
            console.warn(
              "[WARN]",
              "socket error",
              path,
              err.message ?? String(err),
            );
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
              console.warn(
                "[WARN]",
                "error during action",
                err instanceof Error ? err.message : String(err),
              );
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

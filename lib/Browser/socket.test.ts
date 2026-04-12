import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createRetrySenderWithPath } from "./socket";

const generateSocketPath = () =>
  process.platform === "win32"
    ? `\\\\.\\pipe\\makamujo-socket-test-${Date.now().toString(36) + Math.random().toString(36).slice(2)}`
    : join(process.cwd(), "var", `socket-test-${Date.now().toString(36) + Math.random().toString(36).slice(2)}.sock`);

const cleanupSocket = (path: string) => {
  if (!process.platform.startsWith("win") && existsSync(path)) {
    unlinkSync(path);
  }
};

describe("createRetrySenderWithPath", () => {
  let socketPath: string;

  beforeEach(() => {
    socketPath = generateSocketPath();
    cleanupSocket(socketPath);
  });

  afterEach(() => {
    cleanupSocket(socketPath);
  });

  test("connects and sends state once the receiver is listening", async () => {
    const receivedStates: unknown[] = [];

    const server = createServer((conn) => {
      conn.on("data", (buf) => {
        receivedStates.push(JSON.parse(buf.toString()));
        // Respond with a noop action so the sender's run callback fires.
        conn.write(JSON.stringify({ name: "noop" }, null, 0));
      });
    });
    server.listen(socketPath);

    try {
      const receivedActions: unknown[] = [];
      const send = await createRetrySenderWithPath(socketPath)(async (action) => {
        receivedActions.push(action);
      });

      send({ name: "initialized" });

      await sleep(100);

      expect(receivedStates).toContainEqual({ name: "initialized" });
      expect(receivedActions).toContainEqual({ name: "noop" });
    } finally {
      server.close();
    }
  });

  test("retries when socket does not exist yet and eventually connects", async () => {
    const RETRY_DELAY_MS = 50;
    const receivedStates: unknown[] = [];

    // Start the sender *before* the server is listening.
    const senderPromise = createRetrySenderWithPath(socketPath, RETRY_DELAY_MS)(
      async () => {},
      (send) => {
        send({ name: "initialized" });
      },
    );

    // Give the sender a moment to attempt (and fail) the first connect.
    await sleep(RETRY_DELAY_MS * 2);

    // Now start the server.
    const server = createServer((conn) => {
      conn.on("data", (buf) => {
        receivedStates.push(JSON.parse(buf.toString()));
      });
    });
    server.listen(socketPath);

    try {
      await senderPromise;
      // Wait for the retry to succeed and the initial state to arrive.
      await sleep(RETRY_DELAY_MS * 4);

      expect(receivedStates).toContainEqual({ name: "initialized" });
    } finally {
      server.close();
    }
  });

  test("calls onConnect with the send function when connection is established", async () => {
    const receivedStates: unknown[] = [];

    const server = createServer((conn) => {
      conn.on("data", (buf) => {
        receivedStates.push(JSON.parse(buf.toString()));
      });
    });
    server.listen(socketPath);

    try {
      await createRetrySenderWithPath(socketPath)(
        async () => {},
        (send) => {
          send({ name: "initialized" });
        },
      );

      await sleep(100);

      expect(receivedStates).toContainEqual({ name: "initialized" });
    } finally {
      server.close();
    }
  });
});

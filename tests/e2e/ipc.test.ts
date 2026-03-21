import { test, expect } from "@playwright/test";
import type { State } from "automated-gameplay-transmitter";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import { createReceiverWithPath, createSenderWithPath } from "../../lib/Browser/socket";

const randomId = Date.now().toString(36) + Math.random().toString(36).slice(2);
const TEST_SOCKET_PATH = process.platform === "win32"
  ? `\\\\.\\pipe\\makamujo-ipc-${randomId}`
  : join(process.cwd(), "var", `ipc-test-${randomId}.sock`);

test.describe("Browser IPC", () => {
  test.beforeEach(() => {
    if (!process.platform.startsWith("win") && existsSync(TEST_SOCKET_PATH)) {
      unlinkSync(TEST_SOCKET_PATH);
    }
  });

  test.afterEach(() => {
    if (!process.platform.startsWith("win") && existsSync(TEST_SOCKET_PATH)) {
      unlinkSync(TEST_SOCKET_PATH);
    }
  });

  test("can send state and receive action through IPC", async () => {
    let receivedAction: unknown = null;
    let receivedState: State | null = null;

    const receiver = await createReceiverWithPath(TEST_SOCKET_PATH);
    await receiver((state) => {
      receivedState = state;
      return { name: 'noop' };
    });

    const senderFn = await createSenderWithPath(TEST_SOCKET_PATH);
    const sender = await senderFn(async (action) => {
      receivedAction = action;
    });

    // give the server a moment to start
    await new Promise((resolve) => setTimeout(resolve, 100));

    sender({ name: 'idle', url: 'https://example.com' });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(receivedState).toEqual({ name: 'idle', url: 'https://example.com' });
    expect(receivedAction).toEqual({ name: 'noop' });
  });
});

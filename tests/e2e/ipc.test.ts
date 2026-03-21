import { test, expect } from "@playwright/test";
import type { State } from "automated-gameplay-transmitter";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import { createReceiver as createReceiverFactory, createSender as createSenderFactory } from "../../lib/Browser/socket";

const TEST_SOCKET_PATH = join(process.cwd(), "var", "ipc-test.sock");

test.describe("Browser IPC", () => {
  test.beforeEach(() => {
    if (existsSync(TEST_SOCKET_PATH)) {
      unlinkSync(TEST_SOCKET_PATH);
    }
  });

  test.afterEach(() => {
    if (existsSync(TEST_SOCKET_PATH)) {
      unlinkSync(TEST_SOCKET_PATH);
    }
  });

  test("can send state and receive action through IPC", async () => {
    let receivedAction: unknown = null;
    let receivedState: State | null = null;

    const receiverFn = createReceiverFactory;
    await receiverFn((state) => {
      receivedState = state;
      return { name: 'noop' };
    });

    const senderFn = await createSenderFactory;
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

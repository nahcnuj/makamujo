import { expect, test } from "@playwright/test";
import { spawn } from "child_process";
import { existsSync, writeFileSync, createWriteStream, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { cloneAgentStateResponseMockFixture } from "../../fixtures/agentStateResponseMock";

const CONSOLE_BASE_URL = `https://127.0.0.1`;
const BROADCASTING_BASE_URL = `http://127.0.0.1:7777`;
const SERVER_STARTUP_TIMEOUT_MS = 15_000;
const BROWSER_PAGE_LOAD_TIMEOUT_MS = 20_000;
const EXPECTED_CONSOLE_TITLE = "馬可無序 - 管理コンソール";

let server: ReturnType<typeof spawn> | null = null;

const waitForServerReady = async () => {
  return new Promise<void>((resolve, reject) => {
    if (!server) {
      reject(new Error("Server process not started"));
      return;
    }

    if (!server.stdout || !server.stderr) {
      reject(new Error("Server stdout/stderr stream not available"));
      return;
    }

    let settled = false;
    let buffer = "";

    const cleanup = () => {
      clearTimeout(timeout);
      server?.stdout?.off("data", onData);
      server?.off("exit", onExit);
    };

    const resolveOnce = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      if (buffer.includes("Console running")) {
        resolveOnce();
      }
    };

    const onExit = (code: number | null) => {
      rejectOnce(new Error(`Server process exited early with code ${code}`));
    };

    const timeout = setTimeout(() => {
      rejectOnce(new Error("Server startup timed out"));
    }, SERVER_STARTUP_TIMEOUT_MS);

    server.stdout.on("data", onData);
    server.on("exit", onExit);
  });
};

test.beforeAll(async ({ request }) => {
  if (!existsSync("./var/cookieclicker.txt")) {
    writeFileSync("./var/cookieclicker.txt", "");
  }

  // Use a unique IPC path per test run to avoid named-pipe conflicts on
  // Windows CI runners which can cause the server to crash when the
  // default pipe is already in use.
  const randomId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const ipcPath = process.platform === "win32"
    ? `\\\\.\\pipe\\makamujo-ipc-${randomId}`
    : join(process.cwd(), "var", `ipc-${randomId}.sock`);

  server = spawn(
    process.platform === "win32" ? "bun.exe" : "bun",
    ["start"],
    {
<<<<<<< HEAD
      env: {
        ...process.env,
        NODE_ENV: "production",
        CONSOLE_TLS_CERT: process.env.CONSOLE_TLS_CERT,
        CONSOLE_TLS_KEY: process.env.CONSOLE_TLS_KEY,
        CONSOLE_LOOPBACK_ONLY: '1',
        MAKAMUJO_IPC_PATH: ipcPath,
      },
=======
>>>>>>> origin/main
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  await waitForServerReady();

  // Register the test runner's IP as the allowed IP so that subsequent
  // requests to the IP-restricted console server are permitted.
  const allowlistRegistrationResponse = await request.post(`${BROADCASTING_BASE_URL}/`);
  const allowlistRegistrationResponseText = await allowlistRegistrationResponse.text();
  expect(
    allowlistRegistrationResponse.ok(),
    `Allowlist registration failed with status ${allowlistRegistrationResponse.status()} ${allowlistRegistrationResponse.statusText()}: ${allowlistRegistrationResponseText}`,
  ).toBeTruthy();
});

test.afterAll(() => {
  if (server && !server.killed) {
    server.kill();
  }
    env: {
      ...process.env,
      NODE_ENV: "production",
      CONSOLE_TLS_CERT: process.env.CONSOLE_TLS_CERT,
      CONSOLE_TLS_KEY: process.env.CONSOLE_TLS_KEY,
      CONSOLE_LOOPBACK_ONLY: '1',
      MAKAMUJO_IPC_PATH: ipcPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  );

  // Capture server stdout/stderr to files for debugging when tests fail.
  try {
    mkdirSync("./var/test-logs", { recursive: true });
  } catch {}
  const ts = Date.now();
  const outPath = `./var/test-logs/console-server-${ts}.log`;
  const errPath = `./var/test-logs/console-server-${ts}.err.log`;
  const outStream = createWriteStream(outPath);
  const errStream = createWriteStream(errPath);
  server.stdout?.pipe(outStream);
  server.stderr?.pipe(errStream);

  await waitForServerReady();
    await page.goto(`${CONSOLE_BASE_URL}/console/?agentStateMock=1`, { waitUntil: "domcontentloaded", timeout: BROWSER_PAGE_LOAD_TIMEOUT_MS });
    expect(await page.title()).toContain(EXPECTED_CONSOLE_TITLE);
    const rootElement = await page.$("#root");
    expect(rootElement).not.toBeNull();
    await expect(page.getByRole("heading", { name: "馬可無序" })).toBeVisible();
    await expect(page.getByText("最終更新:", { exact: false })).toBeVisible();
    await expect(page.getByTestId("agent-status-details")).not.toContainText("話せる状態");
    await expect(page.getByTestId("agent-status-details")).toContainText("生成N-gram");
    await expect(page.getByTestId("agent-status-details")).toContainText("4-gram");
    await expect(page.getByRole("heading", { level: 3, name: "配信状況" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "マルコフ連鎖モデルの状態" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "ゲームの状態" })).toBeVisible();

    const agentStatusDetails = page.getByTestId("agent-status-details");
    const initialAgentStatusDetailsBoundingBox = await agentStatusDetails.boundingBox();
    expect(initialAgentStatusDetailsBoundingBox).not.toBeNull();
    const initialWidth = initialAgentStatusDetailsBoundingBox?.width ?? 0;

    await page.evaluate((veryLongSpeechText) => {
      const agentStatusDetailsElement = document.querySelector("[data-testid='agent-status-details']");
      if (!(agentStatusDetailsElement instanceof HTMLElement)) {
        throw new Error("agent status details element not found");
      }
      const speechLabelElement = Array.from(agentStatusDetailsElement.querySelectorAll("dt"))
        .find((definitionTermElement) => definitionTermElement.textContent?.trim() === "発話内容");
      const speechValueElement = speechLabelElement?.nextElementSibling;
      if (!(speechValueElement instanceof HTMLElement)) {
        throw new Error("speech value element not found");
      }
      speechValueElement.textContent = veryLongSpeechText;
    }, "あ".repeat(8_000));

    const widthAfterLongSpeechBoundingBox = await agentStatusDetails.boundingBox();
    expect(widthAfterLongSpeechBoundingBox).not.toBeNull();
    const finalWidth = widthAfterLongSpeechBoundingBox?.width ?? 0;
    expect(finalWidth).toBeCloseTo(initialWidth);
  });

  test("connects via WebSocket and updates on broadcast (non-mock)", async ({ page, request }) => {
    // Load the console without mock mode so the UI opens a real WebSocket.
    await page.goto(`${CONSOLE_BASE_URL}/console/`, { waitUntil: "domcontentloaded", timeout: BROWSER_PAGE_LOAD_TIMEOUT_MS });

    // Post the fixture to the broadcasting app which updates the shared agent state.
    const payload = cloneAgentStateResponseMockFixture();
    const res = await request.post(`${BROADCASTING_BASE_URL}/api/meta`, { data: payload });
    expect(res.ok(), `broadcast POST failed: ${res.status()}`).toBeTruthy();

    // Wait for the UI to show the details populated via WebSocket broadcast.
    const detailsLocator = page.getByTestId("agent-status-details");
    // Wait for the details container to exist, then explicitly wait for the
    // updated N-gram value to appear after the broadcast POST. The UI may
    // initially render with previous state so a targeted wait avoids flakes.
    await detailsLocator.waitFor({ timeout: 10_000 });
    await expect(detailsLocator).toContainText("生成N-gram");
    await expect(detailsLocator).toContainText("4-gram", { timeout: 10_000 });
  });
});

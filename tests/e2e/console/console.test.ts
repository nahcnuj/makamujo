import { expect, test } from "@playwright/test";
import { spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";

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

  server = spawn(
    process.platform === "win32" ? "bun.exe" : "bun",
    ["start"],
    {
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
  server = null;
});

test.describe("console", () => {
  test("serves /console/robots.txt", async ({ request }) => {
    const res = await request.get(`${CONSOLE_BASE_URL}/console/robots.txt`);
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text).toContain("Disallow: /");
  });

  test("responds to GET /console/api/agent-state", async ({ request }) => {
    const res = await request.get(`${CONSOLE_BASE_URL}/console/api/agent-state`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("niconama");
  });

  test("renders the console app in a browser", async ({ page }) => {
    await page.goto(`${CONSOLE_BASE_URL}/console/?agentStateMock=1`, { waitUntil: "domcontentloaded", timeout: BROWSER_PAGE_LOAD_TIMEOUT_MS });
    expect(await page.title()).toContain(EXPECTED_CONSOLE_TITLE);
    const rootElement = await page.$("#root");
    expect(rootElement).not.toBeNull();
    await expect(page.getByRole("heading", { name: "配信エージェントの状態" })).toBeVisible();
    await expect(page.getByText("最終更新:", { exact: false })).toBeVisible();
    await expect(page.getByTestId("agent-status-mock-notice")).toContainText("モック表示中");
    await expect(page.getByTestId("agent-status-details")).toContainText("配信エージェント状態モック");
    await expect(page.getByTestId("agent-status-json")).toContainText("\"canSpeak\": true");
  });
});

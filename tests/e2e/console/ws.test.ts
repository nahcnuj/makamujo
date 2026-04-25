import { expect, test } from "@playwright/test";
import { cloneAgentStateResponseMockFixture } from "../../fixtures/agentStateResponseMock";

const BROADCASTING_BASE_URL = `http://127.0.0.1:7777`;
const BROWSER_PAGE_LOAD_TIMEOUT_MS = 20_000;

let CONSOLE_BASE_URL = process.env.CONSOLE_BASE_URL ?? `https://127.0.0.1`;

test.beforeAll(async ({ request }) => {
  // Wait for the console server to be ready by polling /console/robots.txt
  const start = Date.now();
  const deadline = start + 15_000;
  let lastErr: Error | null = null;
  while (Date.now() < deadline) {
    try {
      const health = await request.get(`${CONSOLE_BASE_URL}/console/robots.txt`);
      if (health.ok()) {
        lastErr = null;
        break;
      }
      lastErr = new Error(`unexpected status ${health.status()}`);
    } catch (err) {
      lastErr = err as Error;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (lastErr) {
    // Try fallback to http if https is not responding
    if (CONSOLE_BASE_URL.startsWith("https:")) {
      CONSOLE_BASE_URL = CONSOLE_BASE_URL.replace(/^https:/, "http:");
      const start2 = Date.now();
      const deadline2 = start2 + 15_000;
      lastErr = null;
      while (Date.now() < deadline2) {
        try {
          const health = await request.get(`${CONSOLE_BASE_URL}/console/robots.txt`);
          if (health.ok()) {
            lastErr = null;
            break;
          }
          lastErr = new Error(`unexpected status ${health.status()}`);
        } catch (err) {
          lastErr = err as Error;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }
  if (lastErr) {
    throw new Error(`Console server not responding at ${CONSOLE_BASE_URL}: ${String(lastErr)}`);
  }
});

test("console connects via WebSocket and updates on broadcast", async ({ page, request }) => {
  // Navigate to the console app (non-mock) so the client opens a real WebSocket.
  await page.goto(`${CONSOLE_BASE_URL}/console/`, { waitUntil: "domcontentloaded", timeout: BROWSER_PAGE_LOAD_TIMEOUT_MS });

  // Post the fixture to the broadcasting app which updates the shared agent state.
  const payload = cloneAgentStateResponseMockFixture();
  const res = await request.post(`${BROADCASTING_BASE_URL}/api/meta`, { data: payload });
  expect(res.ok(), `broadcast POST failed: ${res.status()}`).toBeTruthy();

  // Wait for the UI to show the details populated via WebSocket broadcast.
  const detailsLocator = page.getByTestId("agent-status-details");
  await detailsLocator.waitFor({ timeout: 10_000 });
  await expect(detailsLocator).toContainText("生成N-gram");
  await expect(detailsLocator).toContainText("4-gram");
});

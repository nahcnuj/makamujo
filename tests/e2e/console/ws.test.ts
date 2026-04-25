import { expect, test } from "@playwright/test";
import { cloneAgentStateResponseMockFixture } from "../../fixtures/agentStateResponseMock";

const BROADCASTING_BASE_URL = `http://127.0.0.1:7777`;
const BROWSER_PAGE_LOAD_TIMEOUT_MS = 20_000;

test("console connects via WebSocket and updates on broadcast", async ({ page, request }) => {
  // Navigate to the console app (non-mock) so the client opens a real WebSocket.
  const base = process.env.CONSOLE_BASE_URL ?? `https://127.0.0.1`;
  await page.goto(`${base}/console/`, { waitUntil: "domcontentloaded", timeout: BROWSER_PAGE_LOAD_TIMEOUT_MS });

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

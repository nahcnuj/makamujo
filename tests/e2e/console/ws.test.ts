import { expect, test } from "@playwright/test";
import { cloneAgentStateResponseMockFixture } from "../../fixtures/agentStateResponseMock";

const BROADCASTING_BASE_URL = `http://127.0.0.1:7777`;
const BROWSER_PAGE_LOAD_TIMEOUT_MS = 20_000;

let CONSOLE_BASE_URL = process.env.CONSOLE_BASE_URL ?? "";

const CANDIDATE_BASE_URLS = (() => {
  const env = process.env.CONSOLE_BASE_URL;
  const list = [] as string[];
  if (env) list.push(env);
  // Common deployment possibilities
  list.push("https://127.0.0.1:443");
  list.push("https://127.0.0.1");
  list.push("http://127.0.0.1:7777");
  list.push("http://127.0.0.1");
  return list;
})();

async function findResponsiveConsoleBase(request: any): Promise<string> {
  for (const candidate of CANDIDATE_BASE_URLS) {
    const start = Date.now();
    const deadline = start + 8_000;
    let lastErr: Error | null = null;
    while (Date.now() < deadline) {
      try {
        const health = await request.get(`${candidate.replace(/\/$/, "")}/console/robots.txt`);
        if (health.ok()) {
          return candidate.replace(/\/$/, "");
        }
        lastErr = new Error(`unexpected status ${health.status()}`);
      } catch (err) {
        lastErr = err as Error;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`Console server not responding; tried candidates: ${CANDIDATE_BASE_URLS.join(", ")}`);
}

test.beforeAll(async ({ request }) => {
  CONSOLE_BASE_URL = await findResponsiveConsoleBase(request);
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

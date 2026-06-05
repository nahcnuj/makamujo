import { expect, test } from "@playwright/test";
import { createNiconamaCommentClient, parseAgentCommentsFromResponseBody } from "../../lib/niconamaCommentClient";

const ACTUAL_PROGRAM_WATCH_URL = "https://live.nicovideo.jp/watch/user/14171889";
const ENABLE_LIVE_NICONAMA_TESTS = process.env.NICONAMA_LIVE_TESTS === '1';

test.describe("NiconamaCommentClient fallback watch page", () => {
  test.skip(!ENABLE_LIVE_NICONAMA_TESTS, "Live NicoNico tests require NICONAMA_LIVE_TESTS=1");
  test("fetches embedded-data from the actual program watch URL and extracts relive websocket URL and initial comments", async () => {
    const initialComments: any[] = [];
    const client = createNiconamaCommentClient(
      { watchUrl: ACTUAL_PROGRAM_WATCH_URL },
      {
        onComments: (comments) => { initialComments.push(...comments); },
        onMeta: () => {},
        onError: (error) => {
          throw error;
        },
      },
    );

    const embeddedData = await client.fetchEmbeddedData();

    expect(embeddedData).toBeTruthy();
    expect(typeof embeddedData).toBe("object");

    const webSocketUrl = (embeddedData as any).site?.state?.relive?.webSocketUrl ?? (embeddedData as any).site?.relive?.webSocketUrl;
    expect(webSocketUrl).toBeTruthy();
    expect(webSocketUrl).toMatch(/^wss:\/\//);

    const commentCount = (embeddedData as any).program?.statistics?.commentCount;
    expect(typeof commentCount).toBe("number");
    expect(commentCount).toBeGreaterThanOrEqual(0);
    const embeddedComments = parseAgentCommentsFromResponseBody(embeddedData);
    expect(Array.isArray(embeddedComments)).toBe(true);
    expect(embeddedComments.length).toBeLessThanOrEqual(commentCount);

    try {
      await client.start();
      expect(Array.isArray(initialComments)).toBe(true);
      if (initialComments.length > 0) {
        expect(typeof initialComments[0]?.data?.comment).toBe("string");
      }
    } finally {
      await client.stop();
    }
  });

  test("receives embedded initial comments at startup", async () => {
    const initialComments: any[] = [];
    const client = createNiconamaCommentClient(
      { watchUrl: ACTUAL_PROGRAM_WATCH_URL },
      {
        onComments: (comments) => { initialComments.push(...comments); },
        onMeta: () => {},
        onError: (error) => { throw error; },
      },
    );

    const embeddedData = await client.fetchEmbeddedData();
    expect(embeddedData).toBeTruthy();
    const commentCount = (embeddedData as any).program?.statistics?.commentCount;
    expect(typeof commentCount).toBe("number");
    expect(commentCount).toBeGreaterThan(0);

    try {
      await client.start();
      expect(initialComments.length).toBeGreaterThan(0);
      expect(typeof initialComments[0]?.data?.comment).toBe("string");
    } finally {
      await client.stop();
    }
  });
});

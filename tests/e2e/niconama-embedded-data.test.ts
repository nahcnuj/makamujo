import { expect, test } from "@playwright/test";
import { createNiconamaCommentClient, parseAgentCommentsFromResponseBody } from "../../lib/niconamaCommentClient";

const ACTUAL_PROGRAM_WATCH_URL = "https://live.nicovideo.jp/watch/user/14171889";

test.describe("NiconamaCommentClient fallback watch page", () => {
  test("fetches embedded-data from the actual program watch URL and extracts relive websocket URL and initial comments", async () => {
    const client = createNiconamaCommentClient(
      { watchUrl: ACTUAL_PROGRAM_WATCH_URL },
      {
        onComments: () => {},
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

    const initialComments = parseAgentCommentsFromResponseBody(embeddedData);

    expect(Array.isArray(initialComments)).toBe(true);
    expect(initialComments.length).toBeGreaterThan(0);
    expect(initialComments.length).toBeLessThanOrEqual(commentCount);
    if (initialComments.length > 0) {
      expect(typeof initialComments[0]?.data?.comment).toBe("string");
    }
  });
});

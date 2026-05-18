import { expect, test } from "@playwright/test";
import { createNiconamaCommentClient } from "../../lib/niconamaCommentClient";

const ACTUAL_PROGRAM_WATCH_URL = "https://live.nicovideo.jp/watch/user/14171889";

test.describe("NiconamaCommentClient fallback watch page", () => {
  test("fetches embedded-data from the actual program watch URL and extracts relive websocket URL", async () => {
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
    expect((embeddedData as any).site?.state?.relive?.webSocketUrl ?? (embeddedData as any).site?.relive?.webSocketUrl).toBeTruthy();
    expect((embeddedData as any).site?.state?.relive?.webSocketUrl ?? (embeddedData as any).site?.relive?.webSocketUrl).toMatch(/^wss:\/\//);
  });
});

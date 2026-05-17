import { expect, test } from "@playwright/test";
import { createNiconamaCommentClient } from "../../lib/niconamaCommentClient";

test.describe("NiconamaCommentClient fallback watch page", () => {
  test("fetches embedded-data from the actual fallback URL and extracts relive websocket URL", async () => {
    const client = createNiconamaCommentClient(
      {},
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

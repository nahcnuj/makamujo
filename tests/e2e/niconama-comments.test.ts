import { expect, test } from "@playwright/test";
import { createNiconamaCommentClient } from "../../lib/niconamaCommentClient";

const ACTUAL_PROGRAM_WATCH_URL = "https://live.nicovideo.jp/watch/user/14171889";

test.describe("NiconamaCommentClient actual program watch page", () => {
  test("retrieves at least one initial comment from the actual program watch page", async () => {
    const initialComments: any[] = [];
    const client = createNiconamaCommentClient(
      { watchUrl: ACTUAL_PROGRAM_WATCH_URL },
      {
        onComments: (comments) => { initialComments.push(...comments); },
        onMeta: () => {},
        onError: (error) => { throw error; },
      },
    );

    try {
      await client.start();

      const deadline = Date.now() + 30_000;
      while (initialComments.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(initialComments.length).toBeGreaterThan(0);
      expect(typeof initialComments[0]?.data?.comment).toBe("string");
    } finally {
      await client.stop();
    }
  });
});

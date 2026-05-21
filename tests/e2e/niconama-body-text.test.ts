import { expect, test } from "@playwright/test";
import { createNiconamaCommentClient } from "../../lib/niconamaCommentClient";

const ACTUAL_PROGRAM_WATCH_URL = "https://live.nicovideo.jp/watch/user/14171889";

test.describe("NiconamaCommentClient rendered body text", () => {
  test("fetchRenderedWatchPageBodyText returns non-empty body text from the actual watch page", async () => {
    const client = createNiconamaCommentClient(
      { watchUrl: ACTUAL_PROGRAM_WATCH_URL },
      {
        onComments: () => {},
        onMeta: () => {},
        onError: (error) => { throw error; },
      },
    );

    const bodyText = await client.fetchRenderedWatchPageBodyText();

    expect(typeof bodyText).toBe("string");
    expect(bodyText).toBeTruthy();
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });
});

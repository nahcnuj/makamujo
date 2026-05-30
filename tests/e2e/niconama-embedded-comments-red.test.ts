import { test, expect } from "@playwright/test";
import { createNiconamaCommentClient, parseAgentCommentsFromResponseBody } from "../../lib/niconamaCommentClient";

// This is the Red phase test: we assert that when the watch page
// embedded metadata reports a non-zero commentCount the client
// should produce at least one embedded comment. Current observed
// behaviour on the real site is commentCount>0 but no embedded
// comment bodies — this test should fail until Agent/client is
// updated to satisfy it.

const ACTUAL_PROGRAM_WATCH_URL = process.env.NICONAMA_TEST_WATCH_URL ?? "https://live.nicovideo.jp/watch/user/14171889";

test.describe("NiconamaCommentClient Red: embedded comments expected when commentCount>0", () => {
  test.setTimeout(120_000);

  test("embedded metadata with commentCount should contain embedded comments", async () => {
    const client = createNiconamaCommentClient({ watchUrl: ACTUAL_PROGRAM_WATCH_URL }, {
      onComments: () => {},
      onMeta: () => {},
      onError: (err) => { throw err; },
    });

    const embedded = await client.fetchEmbeddedData();
    expect(embedded).toBeTruthy();

    const commentCount = Number((embedded as any)?.program?.statistics?.commentCount ?? 0);
    // If the remote page reports zero comments, this test is not applicable
    // and should be considered skipped (no red-fail). We only assert when
    // commentCount > 0 to capture the reported discrepant behaviour.
    if (commentCount <= 0) {
      test.skip();
      return;
    }

    const embeddedComments = parseAgentCommentsFromResponseBody(embedded);
    // RED: we expect at least one embedded comment when commentCount > 0
    expect(Array.isArray(embeddedComments)).toBe(true);
    expect(embeddedComments.length).toBeGreaterThan(0);
  });
});

import { test, expect } from "@playwright/test";
import { rmSync } from "node:fs";

import { createNiconamaCommentClient } from "../../lib/niconamaCommentClient";

const ACTUAL_PROGRAM_WATCH_URL = "https://live.nicovideo.jp/watch/user/14171889";

test.describe("NiconamaCommentClient E2E (live)", () => {
  test.setTimeout(120000);

  test("start client and receive at least one comment (mirrors run-niconama-client.ts)", async () => {
    const received: any[] = [];
    const client = createNiconamaCommentClient({ watchUrl: ACTUAL_PROGRAM_WATCH_URL, userDataDir: './tmp/niconama-user-data-e2e' }, {
      onComments: (comments) => { console.debug('[TEST] onComments', comments); received.push(...comments); console.debug('[TEST] received length', received.length); },
      onMeta: () => {},
      onError: (err) => { throw err; },
    });

    await client.start();

    try {
      const timeoutMs = 45000;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (received.length > 0) break;
        await new Promise((res) => setTimeout(res, 500));
      }

      expect(received.length).toBeGreaterThan(0);
      expect(typeof received[0]?.data?.comment).toBe("string");
    } finally {
      await client.stop();
      try { rmSync('./tmp/niconama-user-data-e2e', { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

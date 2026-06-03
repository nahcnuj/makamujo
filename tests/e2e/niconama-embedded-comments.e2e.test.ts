import { test, expect } from "@playwright/test";
import { rmSync } from "node:fs";

import { createNiconamaCommentClient } from "../../lib/niconamaCommentClient";

const ACTUAL_PROGRAM_WATCH_URL = process.env.NICONAMA_TEST_WATCH_URL;
const ENABLE_LIVE_NICONAMA_TESTS = process.env.NICONAMA_LIVE_TESTS === '1';
const ENABLE_LIVE_NICONAMA_COMMENT_TEST = ENABLE_LIVE_NICONAMA_TESTS && typeof ACTUAL_PROGRAM_WATCH_URL === 'string' && ACTUAL_PROGRAM_WATCH_URL.trim().length > 0;

test.describe("NiconamaCommentClient E2E (live)", () => {
  test.skip(!ENABLE_LIVE_NICONAMA_COMMENT_TEST, "Live NicoNico comment tests require NICONAMA_LIVE_TESTS=1 and NICONAMA_TEST_WATCH_URL");
  test.setTimeout(120000);

  test("start client and receive at least one comment (mirrors run-niconama-client.ts)", async () => {
    const received: any[] = [];
    const client = createNiconamaCommentClient({ watchUrl: ACTUAL_PROGRAM_WATCH_URL, userDataDir: './tmp/niconama-user-data-e2e' }, {
      onComments: (comments) => { received.push(...comments); },
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

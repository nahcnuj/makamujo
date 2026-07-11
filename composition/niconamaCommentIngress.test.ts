import { afterEach, describe, expect, it } from "bun:test";
import {
  applyNiconamaCommentsToPublishedState,
  buildNiconamaClientOptions,
  scheduleNiconamaCommentIngress,
} from "./niconamaCommentIngress";

describe("buildNiconamaClientOptions", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("does not hardcode system Chromium path", () => {
    delete process.env.CHROMIUM_EXECUTABLE_PATH;
    delete process.env.NICONAMA_WATCH_URL;
    delete process.env.NICONAMA_TEST_WATCH_URL;
    const options = buildNiconamaClientOptions();
    expect(options.executablePath).toBeUndefined();
    expect(options.userDataDir).toBeTruthy();
  });

  it("includes watchUrl and executablePath when env is set", () => {
    process.env.NICONAMA_WATCH_URL = "https://live.nicovideo.jp/watch/lv1";
    process.env.CHROMIUM_EXECUTABLE_PATH = process.execPath;
    const options = buildNiconamaClientOptions();
    expect(options.watchUrl).toBe("https://live.nicovideo.jp/watch/lv1");
    expect(options.executablePath).toBe(process.execPath);
  });
});

describe("applyNiconamaCommentsToPublishedState", () => {
  it("increments commentCount from numbered comments and appends recentComments", () => {
    const next = applyNiconamaCommentsToPublishedState(
      { commentCount: 2, recentComments: [{ comment: "old", no: 1 }] },
      { commentCount: 2 },
      [
        { comment: "hello", no: 3 },
        { comment: "system", userId: "onecomme.system" },
      ],
    );
    expect(next.commentCount).toBe(3);
    expect(Array.isArray(next.recentComments)).toBe(true);
    expect((next.recentComments as unknown[]).length).toBeGreaterThanOrEqual(2);
    const nico = next.niconama as { meta?: { total?: { comments?: number } } };
    expect(nico.meta?.total?.comments).toBe(3);
  });
});

describe("scheduleNiconamaCommentIngress", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("does not start when NICONAMA_DISABLE=1", async () => {
    process.env.NICONAMA_DISABLE = "1";
    let fatal = false;
    const handle = scheduleNiconamaCommentIngress({
      postComments: () => {},
      onMeta: () => {},
      getCurrentStreamPayload: () => ({}),
      getLastPublished: () => ({}),
      setLastPublished: () => {},
      broadcastOnComment: () => {},
      onFatalStartFailure: () => {
        fatal = true;
      },
    });
    await handle.stop();
    expect(fatal).toBe(false);
  });

  it("does not start or fatal when NICONAMA_START_MAX_RETRIES < 1", async () => {
    delete process.env.NICONAMA_DISABLE;
    process.env.NICONAMA_START_MAX_RETRIES = "0";
    let fatal = false;
    const handle = scheduleNiconamaCommentIngress({
      postComments: () => {},
      onMeta: () => {},
      getCurrentStreamPayload: () => ({}),
      getLastPublished: () => ({}),
      setLastPublished: () => {},
      broadcastOnComment: () => {},
      onFatalStartFailure: () => {
        fatal = true;
      },
    });
    await handle.stop();
    expect(fatal).toBe(false);
  });
});

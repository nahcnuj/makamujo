import { describe, expect, it } from "bun:test";
import {
  toOfflineStreamData,
  toStreamDataFromWatchPage,
} from "./ProgramInfoAssembler";

const liveProgram = {
  nicoliveProgramId: "lv351439452",
  title: "テスト配信",
  url: "https://live.nicovideo.jp/watch/lv351439452",
  isLive: true,
  startTime: 1_700_000_000,
  listeners: 321,
  comments: 654,
};

describe("toStreamDataFromWatchPage", () => {
  it("maps the page values onto the stream data contract", () => {
    expect(toStreamDataFromWatchPage(liveProgram, { ad: 4, gift: 7 })).toEqual({
      type: "niconama",
      data: {
        title: "テスト配信",
        isLive: true,
        startTime: 1_700_000_000,
        total: 321,
        comments: 654,
        points: { gift: 7, ad: 4 },
        url: "https://live.nicovideo.jp/watch/lv351439452",
      },
    });
  });

  it("keeps the program identity for an ended program", () => {
    const streamData = toStreamDataFromWatchPage(
      { ...liveProgram, isLive: false },
      { ad: 0, gift: 0 },
    );

    expect(streamData.data.isLive).toBe(false);
    expect(streamData.data.url).toBe(
      "https://live.nicovideo.jp/watch/lv351439452",
    );
  });
});

describe("toOfflineStreamData", () => {
  it("reports an offline program with zeroed metrics", () => {
    expect(toOfflineStreamData({ ad: 0, gift: 0 })).toEqual({
      type: "niconama",
      data: {
        title: "",
        isLive: false,
        startTime: 0,
        total: 0,
        comments: 0,
        points: { gift: 0, ad: 0 },
        url: "",
      },
    });
  });

  it("does not mutate the shared offline template", () => {
    const first = toOfflineStreamData({ ad: 1, gift: 2 });
    const second = toOfflineStreamData({ ad: 0, gift: 0 });

    expect(first.data.points).toEqual({ gift: 2, ad: 1 });
    expect(second.data.points).toEqual({ gift: 0, ad: 0 });
  });
});

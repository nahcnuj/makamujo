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
};

describe("toStreamDataFromWatchPage", () => {
  it("maps the values the statistics row shows", () => {
    expect(
      toStreamDataFromWatchPage(liveProgram, {
        viewers: 321,
        comments: 654,
        nicoadPoints: 40,
        giftPoints: 70,
      }),
    ).toEqual({
      type: "niconama",
      data: {
        title: "テスト配信",
        isLive: true,
        startTime: 1_700_000_000,
        total: 321,
        comments: 654,
        points: { gift: 70, ad: 40 },
        url: "https://live.nicovideo.jp/watch/lv351439452",
      },
    });
  });

  it("keeps missing metrics as undefined so the UI can show a placeholder", () => {
    const streamData = toStreamDataFromWatchPage(liveProgram, {
      viewers: 12,
    });

    expect(streamData.data.total).toBe(12);
    expect(streamData.data.comments).toBeUndefined();
    expect(streamData.data.points).toEqual({
      gift: undefined,
      ad: undefined,
    });
  });

  it("keeps the program identity for an ended program", () => {
    const streamData = toStreamDataFromWatchPage(
      { ...liveProgram, isLive: false },
      { viewers: 5, comments: 6 },
    );

    expect(streamData.data.isLive).toBe(false);
    expect(streamData.data.url).toBe(
      "https://live.nicovideo.jp/watch/lv351439452",
    );
  });
});

describe("toOfflineStreamData", () => {
  it("reports an offline program with no metrics", () => {
    expect(toOfflineStreamData()).toEqual({
      type: "niconama",
      data: {
        title: "",
        isLive: false,
        startTime: 0,
        total: undefined,
        comments: undefined,
        points: {},
        url: "",
      },
    });
  });
});

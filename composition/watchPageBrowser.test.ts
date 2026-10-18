import { describe, expect, it } from "bun:test";
import {
  isWatchPageReadable,
  judgePictureMotion,
  type PictureMotion,
  toDisplayedStatistics,
  type WatchPageRawReading,
} from "./watchPageBrowser";

const motion = (overrides: Partial<PictureMotion> = {}): PictureMotion => ({
  // 60Hz のサンプラーが 30fps の健康な配信映像を観測した既定窓。
  comparedFrames: 180,
  changedFrames: 90,
  windowMs: 3_000,
  tainted: false,
  sawAdvertisement: false,
  ...overrides,
});

describe("toDisplayedStatistics", () => {
  it("turns the displayed text into numbers", () => {
    expect(
      toDisplayedStatistics({
        statistics: {
          viewers: "25",
          comments: "1,055",
          nicoadPoints: "30",
          giftPoints: "40",
        },
        hasStatisticsRow: true,
      }),
    ).toEqual({
      viewers: 25,
      comments: 1055,
      nicoadPoints: 30,
      giftPoints: 40,
    });
  });

  it("keeps metrics the page shows as a placeholder as no value", () => {
    expect(
      toDisplayedStatistics({
        statistics: {
          viewers: "25",
          comments: "-",
          nicoadPoints: "-",
          giftPoints: "-",
        },
        hasStatisticsRow: true,
      }),
    ).toEqual({
      viewers: 25,
      comments: undefined,
      nicoadPoints: undefined,
      giftPoints: undefined,
    });
  });
});

describe("isWatchPageReadable", () => {
  it("accepts a page that shows the statistics row even with placeholders", () => {
    expect(
      isWatchPageReadable({
        statistics: {
          viewers: "-",
          comments: "-",
          nicoadPoints: "-",
          giftPoints: "-",
        },
        hasStatisticsRow: true,
      }),
    ).toBe(true);
  });

  it("rejects a page without the statistics row", () => {
    const raw: WatchPageRawReading = {
      statistics: {
        viewers: null,
        comments: null,
        nicoadPoints: null,
        giftPoints: null,
      },
      hasStatisticsRow: false,
    };

    expect(isWatchPageReadable(raw)).toBe(false);
  });
});

describe("judgePictureMotion", () => {
  it("reads a changing picture as moving", () => {
    expect(judgePictureMotion(motion())).toBe("moving");
  });

  it("reads a picture under the still threshold as still", () => {
    // 凍結した合成出力: 3 秒窓で 0〜1 changed frame。
    expect(judgePictureMotion(motion({ changedFrames: 1 }))).toBe("still");
    expect(judgePictureMotion(motion({ changedFrames: 0 }))).toBe("still");
  });

  it("reads the chronically degraded bands of issue #857 as still", () => {
    // issue #857: videoAvgFps 2.9（changedFrames 9 / 3s）。
    expect(judgePictureMotion(motion({ changedFrames: 9 }))).toBe("still");
    // issue #854: videoAvgFps 21.6（changedFrames 65 / 3s）— 権威は停止と判定する帯域。
    expect(judgePictureMotion(motion({ changedFrames: 65 }))).toBe("still");
  });

  it("treats a picture just above the still threshold as moving", () => {
    // 75 changed frames in 3s = 25 fps > PICTURE_STILL_FPS_THRESHOLD。
    expect(judgePictureMotion(motion({ changedFrames: 75 }))).toBe("moving");
  });

  it("caps the still threshold at half the sampler rate", () => {
    // 10Hz のサンプラーでは 24 fps を観測できない。健康（9 fps で変化）は
    // サンプラーの半分を上回るので動き、凍結に近い 2 fps は静止。
    const slowSampler = { ...motion(), comparedFrames: 30 };
    expect(judgePictureMotion({ ...slowSampler, changedFrames: 27 })).toBe(
      "moving",
    );
    expect(judgePictureMotion({ ...slowSampler, changedFrames: 6 })).toBe(
      "still",
    );
  });

  it("discards windows during an advertisement without judging", () => {
    expect(
      judgePictureMotion(motion({ sawAdvertisement: true })),
    ).toBeUndefined();
  });

  it("discards tainted windows without judging", () => {
    expect(judgePictureMotion(motion({ tainted: true }))).toBeUndefined();
  });

  it("discards windows too short to judge", () => {
    expect(judgePictureMotion(motion({ windowMs: 500 }))).toBeUndefined();
  });

  it("discards windows that compared too few frames", () => {
    expect(
      judgePictureMotion(motion({ comparedFrames: 3, changedFrames: 0 })),
    ).toBeUndefined();
  });
});

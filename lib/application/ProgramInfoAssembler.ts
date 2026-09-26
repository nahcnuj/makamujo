/**
 * 番組配信ページから読んだ値を、既存の節目データ契約
 * （`StreamData` = `{ type: "niconama", data: {...} }`）へ写す境界（ACL）。
 *
 * 視聴者数・コメント数はページ統計行の表示テキストそのまま、
 * ニコニコ広告・ギフトポイントも同じ統計行の表示テキストをそのまま入れる。
 * ページに値が無い（`-`）ときは `undefined` のまま通し、表示側の `-` に委ねる。
 */

import type { WatchPageProgram } from "../domain/broadcasting/watchPageProgram";
import type { DisplayedStatistics } from "../domain/broadcasting/watchPageStatistics";
import type { StreamData } from "./types";

export const toStreamDataFromWatchPage = (
  program: WatchPageProgram,
  statistics: DisplayedStatistics,
): StreamData => ({
  type: "niconama",
  data: {
    title: program.title,
    isLive: program.isLive,
    startTime: program.startTime,
    total: statistics.viewers,
    comments: statistics.comments,
    points: { gift: statistics.giftPoints, ad: statistics.nicoadPoints },
    url: program.url,
  },
});

/** ページに番組情報が無いとき（配信していない）の放送状態。 */
export const toOfflineStreamData = (): StreamData => ({
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

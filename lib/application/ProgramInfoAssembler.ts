/**
 * 番組配信ページから読んだ `WatchPageProgram` を、既存の節目データ契約
 * （`StreamData` = `{ type: "niconama", data: {...} }`）へ写す境界（ACL）。
 *
 * 視聴者数・コメント数はページがそのまま表示している値を入れる。
 * ニコニ広告・ギフトはページに件数が載っていないため、視聴者がページ上で
 * _SYS_コメントとして見ている件数（`CommentApplicationService` が数えた値）を入れる。
 */

import type { WatchPageProgram } from "../domain/broadcasting/watchPageProgram";
import type { StreamData } from "./types";

export type ProgramCounters = {
  /** 視聴済みのニコニコ広告システムコメント件数。 */
  ad: number;
  /** 視聴済みのギフトコメント件数。 */
  gift: number;
};

const OFFLINE_PROGRAM: StreamData = {
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
};

export const toStreamDataFromWatchPage = (
  program: WatchPageProgram,
  counters: ProgramCounters,
): StreamData => ({
  type: "niconama",
  data: {
    title: program.title,
    isLive: program.isLive,
    startTime: program.startTime,
    total: program.listeners,
    comments: program.comments,
    points: { gift: counters.gift, ad: counters.ad },
    url: program.url,
  },
});

/** ページに番組情報が無いとき（配信していない）の放送状態。 */
export const toOfflineStreamData = (counters: ProgramCounters): StreamData => ({
  type: "niconama",
  data: {
    ...OFFLINE_PROGRAM.data,
    points: { gift: counters.gift, ad: counters.ad },
  },
});

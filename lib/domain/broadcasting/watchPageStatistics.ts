/**
 * 番組配信ページの**統計行が画面に表示しているテキスト**を数値へ読む純関数群。
 *
 * ページは 4 指標（視聴者数 / コメント数 / ニコニコ広告ポイント / ギフトポイント）を
 * HTML には `-` プレースホルダで描画し、実際の値は JS が unama WebSocket から
 * 受け取って埋め込む。したがって HTML ではなく**レンダリング後の文字列**を渡す。
 * 値が無いとき（`-`）は `undefined` を返し、表示側の `-` にそのまま委ねる。
 */

/** 画面上の統計行が持っている表示テキスト（DOM からそのまま採取した文字列）。 */
export type DisplayedStatisticsTexts = {
  viewers: string | null | undefined;
  comments: string | null | undefined;
  nicoadPoints: string | null | undefined;
  giftPoints: string | null | undefined;
  timeshiftReservations?: string | null | undefined;
};

/** 数値化した統計。`undefined` は「ページに値が無かった」を意味する。 */
export type DisplayedStatistics = {
  viewers?: number;
  comments?: number;
  nicoadPoints?: number;
  giftPoints?: number;
  timeshiftReservations?: number;
};

/** 日本語の桁表現。ページもこれを使う。 */
const UNIT_MULTIPLIERS: ReadonlyArray<readonly [string, number]> = [
  ["兆", 1e12],
  ["億", 1e8],
  ["万", 1e4],
];

/**
 * 表示テキストを数値にする。`-` / 空文字 / 数値として読めないものは `undefined`。
 *
 * 1,234 / 12.3万 / 1.2億 のような桁表現も受け付け、端数は切り捨てずに保持する。
 */
export const parseDisplayedMetric = (
  text: string | null | undefined,
): number | undefined => {
  if (typeof text !== "string") {
    return undefined;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed === "-") {
    return undefined;
  }

  const unit = UNIT_MULTIPLIERS.find(([suffix]) => trimmed.includes(suffix));
  const numericPart = unit
    ? trimmed.slice(0, trimmed.indexOf(unit[0]))
    : trimmed;
  const normalized = numericPart.replaceAll(",", "").trim();
  if (normalized.length === 0 || !/^\d+(?:\.\d+)?$/.test(normalized)) {
    return undefined;
  }

  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return unit ? value * unit[1] : value;
};

/** 統計行の表示テキスト一式を数値化する。 */
export const parseDisplayedStatistics = (
  texts: DisplayedStatisticsTexts,
): DisplayedStatistics => {
  const statistics: DisplayedStatistics = {};
  const assign = (
    key: keyof DisplayedStatistics,
    text: string | null | undefined,
  ) => {
    const value = parseDisplayedMetric(text);
    if (value !== undefined) {
      statistics[key] = value;
    }
  };
  assign("viewers", texts.viewers);
  assign("comments", texts.comments);
  assign("nicoadPoints", texts.nicoadPoints);
  assign("giftPoints", texts.giftPoints);
  if (texts.timeshiftReservations !== undefined) {
    assign("timeshiftReservations", texts.timeshiftReservations);
  }
  return statistics;
};

/**
 * 番組配信ページ (`https://live.nicovideo.jp/watch/...`) の `embedded-data` script から
 * 番組そのものの情報（タイトル / 開始時刻 / 放送状態 / 番組 URL）を読み取る純関数群。
 *
 * ページは JSON を `data-props` 属性に HTML エスケープして埋め込む。
 * 視聴者数・コメント数・ニコニコ広告ポイント・ギフトポイントは HTML には
 * プレースホルダしか無いため、この型には含めない（`watchPageStatistics.ts` が担当する）。
 */

export type WatchPageProgram = {
  /** 番組 ID（`lv...`）。番組の同一性として URL と対で使う。 */
  nicoliveProgramId: string;
  title: string;
  url: string;
  /** ページ表示の放送状態に基づく。`ON_AIR` のときだけ true。 */
  isLive: boolean;
  /** 放送開始時刻（unix 秒）。 */
  startTime: number;
};

const EMBEDDED_DATA_PATTERN = /<script id="embedded-data" data-props="([^"]*)"/;

const HTML_ENTITIES: ReadonlyArray<readonly [string, string]> = [
  ["&quot;", '"'],
  ["&#39;", "'"],
  ["&apos;", "'"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&amp;", "&"],
];

/**
 * `data-props` に含まれる HTML エンティティ参照を文字へ戻す。
 * `&amp;` は最後に置換する（先に解除すると他の実体参照と二重に潰れる）。
 */
export const decodeHtmlEntities = (value: string): string => {
  let decoded = value;
  for (const [entity, character] of HTML_ENTITIES) {
    decoded = decoded.replaceAll(entity, character);
  }
  return decoded;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

/**
 * 配信ページの HTML から番組情報を読む。
 * 番組情報が載っていないページ（放送していない・番組が存在しない）は undefined を返す。
 */
export const parseWatchPageProgram = (
  html: string,
): WatchPageProgram | undefined => {
  const matched = html.match(EMBEDDED_DATA_PATTERN);
  const rawProps = matched?.[1];
  if (rawProps === undefined) {
    return undefined;
  }
  return parseWatchPageProgramProps(decodeHtmlEntities(rawProps));
};

/**
 * `embedded-data` の `data-props` 値（JSON 文字列）から番組情報を読む。
 * ブラウザ経由でページを開いているときは属性値が既にデコード済みなのでこちらを使う。
 */
export const parseWatchPageProgramProps = (
  propsJson: string,
): WatchPageProgram | undefined => {
  let props: unknown;
  try {
    props = JSON.parse(propsJson);
  } catch {
    return undefined;
  }

  const program = asRecord(asRecord(props)?.program);
  if (program === undefined) {
    return undefined;
  }

  const nicoliveProgramId = asString(program.nicoliveProgramId);
  if (nicoliveProgramId === undefined || nicoliveProgramId.length === 0) {
    return undefined;
  }

  return {
    nicoliveProgramId,
    title: asString(program.title) ?? "",
    url:
      asString(program.watchPageUrl) ??
      `https://live.nicovideo.jp/watch/${nicoliveProgramId}`,
    isLive: program.status === "ON_AIR",
    startTime: asCount(program.beginTime),
  };
};

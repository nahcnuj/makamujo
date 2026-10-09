/**
 * ユーザーページの番組タブが埋め込む放送履歴 API
 * (`user-broadcast-history`) のレスポンスから、最新番組の終了時刻を読む純関数。
 *
 * GARAGE のライブ履歴ページは iframe を失い、ユーザーページの番組タブへ移った。
 * そのタブは React で描画され、HTML には番組情報が載らない。DOM にも終了時刻を
 * 持つ要素はなく、描画されるのは開始時刻と尺だけである。そこで、タブが読む同じ
 * API を直接読んで終了時刻 (epoch 秒) を得る。応答は新しい番組が先頭で、ログイン
 * なしで取得できる。
 */

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;

/** 時刻は `{ seconds, nanos }` で来るので、epoch 秒として読む。 */
const readEpochSeconds = (value: unknown): number | undefined => {
  const seconds = asRecord(value)?.seconds;
  return typeof seconds === "number" && Number.isFinite(seconds)
    ? seconds
    : undefined;
};

/**
 * 番組 1 件から終了時刻を返す。終了時刻が無い (放映前など) 場合は `undefined`。
 * 終了済みなら終了時刻、予定なら終了予定時刻が同じ位置に入るため、そちらも読む。
 */
const readProgramEndAt = (item: unknown): Date | undefined => {
  const program = asRecord(asRecord(item)?.program);
  const schedule = asRecord(program?.schedule);
  const seconds =
    readEpochSeconds(schedule?.endTime) ??
    readEpochSeconds(schedule?.scheduledEndTime);
  return seconds === undefined ? undefined : new Date(seconds * 1000);
};

/**
 * 最新番組の終了時刻を返す。終了時刻を持つ最初の番組を採用する (一覧は新しい順な
 * ので最新の値になる)。番組が無く、終了時刻も読めなければ `undefined`。
 */
export const findLatestProgramEndAt = (response: unknown): Date | undefined => {
  const programsList = asRecord(asRecord(response)?.data)?.programsList;
  if (!Array.isArray(programsList)) {
    return undefined;
  }
  for (const program of programsList) {
    const endAt = readProgramEndAt(program);
    if (endAt) {
      return endAt;
    }
  }
  return undefined;
};

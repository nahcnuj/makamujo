/**
 * 浮遊する「（コメントしてね）」を出すか。
 *
 * 発話が無いとき（`silent`）だけでなく、発話行が空のときも出す。空の発話欄は
 * 見た目が完全に静止し、その間にゲームも止まっていると配信映像が全フレーム
 * 同一になる（issue #995）。コメント待ちの間も動き続ける表示で埋める。
 */
export const shouldShowSilentCaption = (
  silent: boolean,
  speechLineCount: number,
): boolean => silent || speechLineCount === 0;

/**
 * 停止時の統計ソースの後始末。index.ts の終了ハンドラから呼ぶ。
 *
 * 統計ソースは Playwright の Chromium を 1 つ抱えており、その実体を閉じないと
 * 自動生成された一時プロファイル（数十 MB）が OS の一時ディレクトリに残る。
 * SIGTERM で終わるサーバは自前で `browser.close()` に到達しないので、ここで
 * 明示的に閉じない限り再起動のたびにプロファイルが積み上がる（VPS の /tmp は
 * 2 GB の tmpfs で、メモリ圧迫の原因になる）。
 */

import type { WatchPageStatisticsSource } from "./watchPageStatisticsSource";

/**
 * ブラウザが `close()` に応答しない場合でも停止を止めないための猶予。
 * systemd は SIGTERM のあと `TimeoutStopSec`（30 秒）で SIGKILL するので、
 * それより十分短くしておく。
 */
export const SHUTDOWN_GRACE_MS = 10_000;

/**
 * 統計ソースを停止し、抱えている Chromium を閉じさせる。
 *
 * 停止自体は失敗してもかまわない（終了処理を巻き添えにしない）ので、例外は
 * 握りつぶして警告に留める。`close()` が返らないブラウザに備えて待ち時間には
 * 上限を設け、超過したら諦めて呼び出し側の終了を進める。
 */
export const stopWatchPageStatisticsSource = async (
  source: WatchPageStatisticsSource | undefined,
  timeoutMs: number = SHUTDOWN_GRACE_MS,
): Promise<void> => {
  if (!source) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([source.stop(), timeout]);
  } catch (error) {
    console.warn(
      "[WARN] failed to stop the watch page statistics source:",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

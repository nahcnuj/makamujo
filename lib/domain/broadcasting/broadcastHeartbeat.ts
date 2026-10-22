/**
 * 配信映像の鼓動（帯）のジオメトリ契約。
 *
 * 外からの配信異常検知（`scripts/check-stream.ts` は改変しない: owner 契約
 * #807）は 10 秒窓を 1 秒バケットに切り、各バケットで 24 枚以上（ゲーム部分は
 * 左 60% で 8 枚以上）変化したフレームを要求する。比較は 128x72 に縮めた絵を
 * 1 サンプル行ずつ行うので、**検知が見える最小の動きは 1 サンプル行**である。
 *
 * 帯は 1 配信フレーム（30fps）で 1 サンプル行以上動かなければ、縮めの丸めや
 * エンコードの平滑化で差が消えて「停止」と数えられる。だから帯の速さ・高さ・
 * 動く範囲は純関数としてここに置き、出荷する CSS
 * （`src/index.html` の `broadcast-heartbeat-sweep`）はこの値を保つ。
 */

/** 検知側が比較する標本の最大辺（128x72）。 */
export const BROADCAST_HEARTBEAT_SAMPLE_MAX_DIMENSION = 128;

/** 検知側が比較する標本の行数（128x72）。 */
export const BROADCAST_HEARTBEAT_SAMPLE_ROWS = 72;

/**
 * 帯が 1 配信フレームで動かす標本行数の下限。1 行ちょうどでは縮めの丸めと
 * エンコードの平滑化で差が消える余裕が無いので、これを超えることを要求する。
 */
export const BROADCAST_HEARTBEAT_MINIMUM_SAMPLE_ROWS_PER_FRAME = 1;

/** 配信のフレームレート。 */
export const BROADCAST_HEARTBEAT_DELIVERY_FPS = 30;

/** 帯のジオメトリ。 */
export type BroadcastHeartbeatGeometry = {
  /** 配信する絵の幅（px）。 */
  pictureWidthPx: number;
  /** 配信する絵の高さ（px）。 */
  pictureHeightPx: number;
  /** 帯が 1 方向へ進む量（vh）。 */
  travelVh: number;
  /** 帯の高さ（vh）。 */
  bandHeightVh: number;
  /** 1 方向へ進むのにかかる時間（秒）。 */
  sweepSeconds: number;
  /** 配信のフレームレート（fps）。 */
  deliveryFps: number;
};

/**
 * 出荷する帯のジオメトリ。`src/index.html` の CSS
 * （`translateY(92vh)`、高さ `8vh`、`1s linear infinite alternate`）と
 * 1 対 1 対応する。
 */
export const BROADCAST_HEARTBEAT_DEFAULT_GEOMETRY: BroadcastHeartbeatGeometry =
  {
    pictureWidthPx: 1280,
    pictureHeightPx: 720,
    travelVh: 92,
    bandHeightVh: 8,
    sweepSeconds: 1,
    deliveryFps: 30,
  };

/** 検知側が絵を縮める率。 */
export function heartbeatSampleScale(
  geometry: BroadcastHeartbeatGeometry,
): number {
  const longest = Math.max(geometry.pictureWidthPx, geometry.pictureHeightPx);
  if (longest <= 0) return 1;
  return Math.min(1, BROADCAST_HEARTBEAT_SAMPLE_MAX_DIMENSION / longest);
}

/** 標本の 1 行が元の絵で何 px に当たるか。 */
export function sampleRowHeightPx(
  pictureHeightPx: number,
  sampleRows: number = BROADCAST_HEARTBEAT_SAMPLE_ROWS,
): number {
  if (sampleRows <= 0) return pictureHeightPx;
  return pictureHeightPx / sampleRows;
}

/** 帯が 1 配信フレームで進める px。 */
export function heartbeatMovementPxPerFrame(
  geometry: BroadcastHeartbeatGeometry,
): number {
  if (geometry.sweepSeconds <= 0) return 0;
  if (geometry.deliveryFps <= 0) return 0;
  const travelPx = (geometry.travelVh / 100) * geometry.pictureHeightPx;
  return travelPx / (geometry.sweepSeconds * geometry.deliveryFps);
}

/** 帯が 1 配信フレームで動かす標本行数。 */
export function heartbeatSampleRowsPerFrame(
  geometry: BroadcastHeartbeatGeometry,
): number {
  const rowHeightPx = sampleRowHeightPx(geometry.pictureHeightPx);
  if (rowHeightPx <= 0) return 0;
  return heartbeatMovementPxPerFrame(geometry) / rowHeightPx;
}

/**
 * 帯が画面の中に収まるか。画面外へ完全に出る時間帯を作ると、その間の 1 秒
 * バケットが 0 枚になって停止と数えられる。
 */
export function heartbeatStaysOnScreen(
  geometry: BroadcastHeartbeatGeometry,
): boolean {
  if (geometry.bandHeightVh <= 0) return false;
  if (geometry.travelVh < 0) return false;
  return geometry.travelVh + geometry.bandHeightVh <= 100;
}

/** 帯のジオメトリの判定結果。 */
export type BroadcastHeartbeatEvaluation = {
  /** 1 配信フレームで進める px。 */
  movementPxPerFrame: number;
  /** 1 配信フレームで動かす標本行数。 */
  sampleRowsPerFrame: number;
  /** 画面の中に収まるか。 */
  staysOnScreen: boolean;
  /** 外からの検知で見えるか。 */
  detectable: boolean;
};

/** 帯のジオメトリを判定する。 */
export function evaluateBroadcastHeartbeat(
  geometry: BroadcastHeartbeatGeometry = BROADCAST_HEARTBEAT_DEFAULT_GEOMETRY,
): BroadcastHeartbeatEvaluation {
  const movementPxPerFrame = heartbeatMovementPxPerFrame(geometry);
  const sampleRowsPerFrame = heartbeatSampleRowsPerFrame(geometry);
  const staysOnScreen = heartbeatStaysOnScreen(geometry);
  return {
    movementPxPerFrame,
    sampleRowsPerFrame,
    staysOnScreen,
    detectable:
      staysOnScreen &&
      sampleRowsPerFrame > BROADCAST_HEARTBEAT_MINIMUM_SAMPLE_ROWS_PER_FRAME,
  };
}

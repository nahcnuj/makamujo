/**
 * 配信映像の「鼓動」帯の幾何の契約。
 *
 * 外からの異常検知（`scripts/check-stream.ts`。owner 契約 #807 により改変
 * しない）は、配信映像を横 128px の標本へ落として、隣接する標本の差が
 * チャネル許容差 16 を超えた画素が 0.1% 以上あるフレームを「動いた」と数え、
 * 1 秒バケットで 24 枚以上動かなければ停止とみなす
 * （`VIDEO_MIN_FPS` / `GAME_MIN_FPS`）。
 *
 * 標本の 1 行は、画面 720px なら 10px を覆う。帯が 1 配信フレームで標本 1 行
 * を移さないと、落とした標本では帯が占める行が隣のフレームと同じになり、
 * 変わるのは帯の縁の 1 行ぶんに限られる。縁だけの差では、非可逆圧縮（配信の
 * H.264 や JPEG の近似）を 1 往復しただけでは差が消えてしまい、「止まった絵」
 * と区別できなくなる。
 *
 * そこで帯は **標本 1 行以上を 1 配信フレームごとに移す** ことを契約にする。
 * これは検知の厳密な閾値ではなく余裕（マージン）で、実際に標本がどう見える
 * かは統合テスト（`tests/integration/broadcast-heartbeat-detection.test.ts`）
 * が shipping される CSS と要素から採った絵で測る。
 *
 * 帯はゲーム部分として切り出す左 60% にも必ず掛かるよう全幅で、待ちの無い
 * `linear infinite` で回し続ける（画面外に出る時間帯を作らない）。
 */

/** 帯の高さ（画面の高さに対する割合）。 */
export const BROADCAST_HEARTBEAT_BAND_HEIGHT_VH = 6;

/**
 * 帯が 1 周期で進む距離（vh）。
 *
 * 帯の高さが 6vh なので 94vh まで進めても帯は画面内に残り、下端の 6vh だけが
 * 画面外へ出る。帯が画面から完全に消える時間帯を作らない。
 */
export const BROADCAST_HEARTBEAT_SWEEP_TRAVEL_VH = 94;

/**
 * 帯が 1 周期でかかる時間（秒）。
 *
 * 720px の画面で 1.5 秒に 94vh を進めると、1 配信フレーム（30fps）あたり
 * 15.0px = 標本 1 行（10px）の 1.5 行ぶん動く。速さが足りないと標本に
 * 落とした絵が隣のフレームと区別できなくなる。
 */
export const BROADCAST_HEARTBEAT_SWEEP_SECONDS = 1.5;

/** 配信へ流れる絵のフレームレート（OBS の browser source の設定）。 */
export const BROADCAST_HEARTBEAT_DELIVERY_FPS = 30;

/** 外からの検知が絵を標本へ落とすときの標本の横の上限（px）。 */
export const BROADCAST_HEARTBEAT_SAMPLE_MAX_DIMENSION = 128;

/**
 * 標本の高さ（行数）。
 *
 * 1280x720 の映像は 128x72 に落ちる（`MAX_SAMPLE_DIMENSION` = 128）。標本の
 * 1 行は画面 720px なら 10px になる。
 */
export const BROADCAST_HEARTBEAT_SAMPLE_ROWS = 72;

/** 帯の幾何を評価するときの入力。 */
export interface HeartbeatBandGeometry {
  /** 配信画面の高さ（px）。720 のとき 6vh は 43.2px。 */
  pictureHeightPx: number;
  /** 帯が 1 周期で進む距離（vh）。 */
  travelVh: number;
  /** 帯が 1 周期でかかる時間（秒）。 */
  sweepSeconds: number;
  /** 配信のフレームレート（fps）。 */
  deliveryFps: number;
  /** 標本化後の高さ（行数）。 */
  sampleRows: number;
}

/**
 * 標本の 1 行が覆う画面上の高さ（px）。
 *
 * 検知側が絵を 128x72 に落とすので、720px の画面では 1 行 = 10px。
 */
export const sampleRowHeightPx = (
  pictureHeightPx: number,
  sampleRows: number,
): number => pictureHeightPx / Math.max(1, sampleRows);

/** 帯が 1 配信フレームで進む距離（px）。 */
export const heartbeatMovementPxPerFrame = (
  geometry: HeartbeatBandGeometry,
): number => {
  if (geometry.sweepSeconds <= 0 || geometry.deliveryFps <= 0) {
    // 止まった帯 / 配信されないフレームでは動かない。
    return 0;
  }
  const travelPx = (geometry.travelVh / 100) * geometry.pictureHeightPx;
  const frames = Math.max(1, geometry.sweepSeconds * geometry.deliveryFps);
  return travelPx / frames;
};

/**
 * 帯が標本 1 行ぶんの余裕を保って動くか。
 *
 * 標本 1 行より速く動いているときだけ真。落ちた標本が隣のフレームと区別できる
 * よう、带の CSS はこの値を保つように決める。
 */
export const keepsSampleRowMargin = (
  geometry: HeartbeatBandGeometry,
): boolean =>
  heartbeatMovementPxPerFrame(geometry) >
  sampleRowHeightPx(geometry.pictureHeightPx, geometry.sampleRows);

/** 本番の配信画面（1280x720）に対する、既定の帯の幾何。 */
export const DEFAULT_HEARTBEAT_BAND_GEOMETRY: HeartbeatBandGeometry = {
  pictureHeightPx: 720,
  travelVh: BROADCAST_HEARTBEAT_SWEEP_TRAVEL_VH,
  sweepSeconds: BROADCAST_HEARTBEAT_SWEEP_SECONDS,
  deliveryFps: BROADCAST_HEARTBEAT_DELIVERY_FPS,
  sampleRows: BROADCAST_HEARTBEAT_SAMPLE_ROWS,
};

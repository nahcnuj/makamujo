/**
 * 配信映像に常時流れる鼓動帯（`src/index.css` の `broadcast-heartbeat-sweep`）
 * の掃引の不変条件。
 *
 * 外からの配信異常検知は 1 秒バケットごとに 24 枚以上の変化したフレームを
 * 要求する（`scripts/check-stream.ts` の `VIDEO_MIN_FPS`、改変しない: owner
 * 契約 #807）。帯が画面から完全に出る瞬間を作ると、その瞬間を含むバケットは
 * 変化したフレームが足りず停止と数えられる。掃引のどこで帯が画面内に残る
 * 最小の高さ (vh) を返し、画面外に置いた掃引を実装に書かせない。
 */

/** 鼓動帯の掃引。座標は画面の高さ (vh)、上端基準。 */
export type HeartbeatSweep = {
  /** 帯の高さ (vh)。 */
  bandHeightVh: number;
  /** 掃引開始時の帯の上端 (vh)。画面の上端より上は負。 */
  fromYvh: number;
  /** 掃引終了時の帯の上端 (vh)。 */
  toYvh: number;
};

/** 画面の上端 (vh)。 */
const VIEWPORT_TOP_VH = 0;
/** 画面の下端 (vh)。CSS の `vh` 単位に一致させる。 */
const VIEWPORT_BOTTOM_VH = 100;

/**
 * 上端が指定位置にある帯が画面内に残す高さ (vh)。
 * 画面より上・下に完全に出た帯は 0。
 */
function visibleBandHeightVh(topYvh: number, bandHeightVh: number): number {
  const visibleTopVh = Math.min(
    Math.max(topYvh, VIEWPORT_TOP_VH),
    VIEWPORT_BOTTOM_VH,
  );
  const visibleBottomVh = Math.min(
    Math.max(topYvh + bandHeightVh, VIEWPORT_TOP_VH),
    VIEWPORT_BOTTOM_VH,
  );
  return visibleBottomVh - visibleTopVh;
}

/**
 * 掃引のどこで帯が画面内 (0vh..100vh) に残る最小の高さ (vh)。
 * 平行移動だけで掃引するので内側の滞在量は端点が最悪になる。0 は
 * 掃引の少なくとも片端で帯が完全に画面外（または縁の外）にあること。
 */
export function minVisibleBandHeightVh(sweep: HeartbeatSweep): number {
  const visibleAtFrom = visibleBandHeightVh(sweep.fromYvh, sweep.bandHeightVh);
  const visibleAtTo = visibleBandHeightVh(sweep.toYvh, sweep.bandHeightVh);
  return Math.min(visibleAtFrom, visibleAtTo);
}

/** 掃引のどこで帯が画面内に残ること（はみ出る瞬間を作らないこと）を表す。 */
export function sweepsWithoutLeavingViewport(sweep: HeartbeatSweep): boolean {
  return minVisibleBandHeightVh(sweep) > 0;
}

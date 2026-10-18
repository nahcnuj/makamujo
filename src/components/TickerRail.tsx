import type { CSSProperties } from "hono/jsx/dom";

/**
 * 配信出力を毎フレーム変化させる下部ティッカーの契約。
 *
 * `scripts/check-stream.ts`（改変しない: owner 契約 #807）は、配信ページを
 * 描画した映像を 128px 縮小して隣接フレームを比較し、映像全体でどの1 秒
 * バケットでも 24 フレーム以上（`VIDEO_MIN_FPS`）、ゲーム枠（左 60% ×
 * 高さ全体、`GAME_CLIP`）で 8 フレーム以上（`GAME_MIN_FPS`）が
 * 「変化したフレーム」であることを配信の健康とみなす。1 フレームの変化は
 * チャンネル差 16 超のピクセルが全体の 0.1%（≒10px）以上である必要がある。
 * テンポの遅い盤面と静かなコメント欄だけの時間帯はこの下限を割り、
 * 「映像が停止し続けています」と誤検知される（#865 / #867 / #868）。
 */
/** `scripts/check-stream.ts` の MAX_SAMPLE_DIMENSION(128) に対する実画面(1280px)の縮小率 */
export const CHECK_SAMPLE_SCALE_PX = 10;
/** OBS ブラウザソースと配信出力のフレームレート（obs-studio 設定） */
export const OUTPUT_FPS = 30;
/**
 * 縮小画像が毎フレーム 1px（実画面 10px）動くための最低速度。
 * これ未満だと隣接比較が変化を数えられない。
 */
export const MIN_SCROLL_PX_PER_SECOND = OUTPUT_FPS * CHECK_SAMPLE_SCALE_PX;
/** 実効速度。下限の 1.2 倍にして余裕を持たせる */
export const TICKER_SCROLL_SPEED_PX_PER_SECOND = 360;
/** ストライプ周期（グラデーション軸上、px） */
export const TICKER_STRIPE_PERIOD_PX = 16;
/** ストライプ角度（CSS linear-gradient 度数: 135 = 右下向き） */
export const TICKER_STRIPE_ANGLE_DEG = 135;
/** 純黒を避ける2色（OBS のカラーキーが黒を抜くため） */
export const TICKER_STRIPE_DARK_COLOR = "#064e3b";
export const TICKER_STRIPE_LIGHT_COLOR = "#6ee7b7";
/** 1 本のストリップ幅の目標。2 枚で 1920px 幅の開発画面も全幅覆う */
export const TICKER_STRIP_TARGET_PX = 1920;

/**
 * ストライプが横に現れる周期。グラデーション軸の水平成分 |sin θ| だけ
 * 横移動で模様がずれるため、軸上周期をそれ倍して求める。
 * 軸が上下（θ = 0° / 180°）だと横スクロールで模様が動かない（Infinity）。
 */
export function computeStripeXPeriodPx(
  periodPx: number,
  angleDeg: number,
): number {
  const horizontalComponent = Math.abs(Math.sin((angleDeg * Math.PI) / 180));
  // sin(180°) は浮動小数点では 0 にならないため境界を丸める
  if (horizontalComponent < 1e-12) return Number.POSITIVE_INFINITY;
  return periodPx / horizontalComponent;
}

/**
 * 模様の継ぎ目が消えるよう、ストリップ幅を x 周期の整数倍にする。
 * ループの戻り位置と模様の周期が一致するので、スクロールは途切れない。
 */
export function computeTickerStripWidthPx(
  xPeriodPx: number,
  targetPx: number,
): number {
  const periods = Math.max(1, Math.ceil(targetPx / xPeriodPx));
  return periods * xPeriodPx;
}

/** 1 ストリップ分を速度通りに進めるアニメーション時間（ms） */
export function computeTickerAnimationMs(
  stripWidthPx: number,
  speedPxPerSecond: number,
): number {
  return (stripWidthPx / speedPxPerSecond) * 1000;
}

/** 高コントラストな2色の斜めストライプ */
export function buildTickerStripeGradient(
  angleDeg: number,
  periodPx: number,
  darkColor: string,
  lightColor: string,
): string {
  const half = periodPx / 2;
  return `repeating-linear-gradient(${angleDeg}deg, ${darkColor} 0 ${half}px, ${lightColor} ${half}px ${periodPx}px)`;
}

export type TickerMotion = {
  /** 1 枚のストリップ幅（x 周期の整数倍・目標幅以上） */
  stripWidthPx: number;
  animationMs: number;
  gradient: string;
  /** 背景タイルを x 周期ぴったりにして継ぎ目を消す */
  backgroundSize: string;
};

export function resolveTickerMotion(): TickerMotion {
  const xPeriodPx = computeStripeXPeriodPx(
    TICKER_STRIPE_PERIOD_PX,
    TICKER_STRIPE_ANGLE_DEG,
  );
  const stripWidthPx = computeTickerStripWidthPx(
    xPeriodPx,
    TICKER_STRIP_TARGET_PX,
  );
  return {
    stripWidthPx,
    animationMs: computeTickerAnimationMs(
      stripWidthPx,
      TICKER_SCROLL_SPEED_PX_PER_SECOND,
    ),
    gradient: buildTickerStripeGradient(
      TICKER_STRIPE_ANGLE_DEG,
      TICKER_STRIPE_PERIOD_PX,
      TICKER_STRIPE_DARK_COLOR,
      TICKER_STRIPE_LIGHT_COLOR,
    ),
    backgroundSize: `${xPeriodPx}px 100%`,
  };
}

/**
 * 下部パネル上端に置く常時スクロールのストライプ・リボン。
 * ゲーム枠（左 60%）にまたがるので、映像全体とゲーム枠の両方に
 * 毎フレームの変化が立つ。沈黙中も止めない（沈黙は映像の話ではない）。
 */
export function TickerRail() {
  const { stripWidthPx, animationMs, gradient, backgroundSize } =
    resolveTickerMotion();
  const stripStyle: CSSProperties = {
    width: `${stripWidthPx}px`,
    backgroundImage: gradient,
    backgroundSize,
  };
  return (
    <div
      data-testid="stream-ticker"
      aria-hidden="true"
      className="h-3 flex-none overflow-hidden"
    >
      <div
        className="flex h-full w-max"
        style={{
          animation: `ticker-rail-scroll ${animationMs}ms linear infinite`,
        }}
      >
        <div className="h-full shrink-0" style={stripStyle} />
        <div className="h-full shrink-0" style={stripStyle} />
      </div>
    </div>
  );
}

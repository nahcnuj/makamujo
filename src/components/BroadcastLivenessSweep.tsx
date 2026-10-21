import { useEffect, useRef } from "hono/jsx/dom";

/**
 * 配信画面の「動かし」。
 *
 * 配信が静止画になると健康チェック (scripts/check-stream.ts) が
 * 「映像全体が停止し続けています」/「ゲーム画面部分が停止し続けています」を
 * 報告する (issue #982)。判定は配信画面を 128x72 に縮めて 1 フレームごとの
 * 差分を見ることなので、**背景が何色でも** 1 フレームごとに十分大きい
 * 差分が出るように帯を敷く必要がある:
 *
 * - 帯の中で色が変化している (背景が白でも差分が出る)。
 *   半透明の単色帯は背景が明るいと差分がしきい値 (channel tolerance 16) に
 *   届かず、0 FPS のままになる。
 * - 帯は不透明。OBS のカラーキーは黒い絵を抜くので、半透明の帯は
 *   key で消えてしまう。
 * - 帯はゲーム画面 (画面の左 60%) にも被っていなければならない。右側の
 *   パネルだけを動かすと「ゲーム画面部分」の判定を満たさないことになる。
 *
 * 高さと周期は健康チェックのしきい値 (24 FPS 超) に対して余裕を持つように
 * 決めてある。数値を変えたら BroadcastLivenessSweep.test.tsx の
 * サンプリング検証が落ちる。
 */

/** 帯の高さ (画面の高さの比)。 */
export const LIVENESS_SWEEP_HEIGHT_VH = 3;

/** 帯が画面の上から下 (または下から上) へ動くのにかかる時間 (秒)。 */
export const LIVENESS_SWEEP_ONE_WAY_SECONDS = 2;

/** 帯の始点 (画面上の位置)。画面の上の外から入ってくる。 */
export const LIVENESS_SWEEP_START_VH = -3;

/** 帯の終点 (画面上の位置)。画面の下まで抜けていく。 */
export const LIVENESS_SWEEP_END_VH = 103;

/** 帯の上端の色 (emerald-300)。 */
export const LIVENESS_SWEEP_FROM_COLOR = { r: 52, g: 211, b: 153 } as const;

/** 帯の下端の色 (ピンク)。上端と十分違う色にして背景によらず差分を出す。 */
export const LIVENESS_SWEEP_TO_COLOR = { r: 255, g: 190, b: 240 } as const;

/** `rgb()` の CSS 色へ変換する。 */
export const toLivenessSweepCssColor = (color: {
  r: number;
  g: number;
  b: number;
}): string => `rgb(${color.r}, ${color.g}, ${color.b})`;

/**
 * 配信画面の最前面に、絶えず動き続ける帯を敷く。
 *
 * 位置は CSS アニメーションではなく Web Animations API で動かす。健康
 * チェックが測るのは実際に合成された絵なので、帯が動いていれば合成結果も
 * 動き続ける (OBS の browser source は 30fps で描き直す)。
 */
export function BroadcastLivenessSweep() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const animation = element.animate(
      [
        { transform: `translateY(${LIVENESS_SWEEP_START_VH}vh)` },
        { transform: `translateY(${LIVENESS_SWEEP_END_VH}vh)` },
      ],
      {
        duration: LIVENESS_SWEEP_ONE_WAY_SECONDS * 1000,
        iterations: Number.POSITIVE_INFINITY,
        easing: "linear",
        direction: "alternate",
      },
    );
    return () => animation.cancel();
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="broadcast-liveness-sweep"
      style={{
        height: `${LIVENESS_SWEEP_HEIGHT_VH}vh`,
        background: `linear-gradient(to bottom, ${toLivenessSweepCssColor(
          LIVENESS_SWEEP_FROM_COLOR,
        )}, ${toLivenessSweepCssColor(LIVENESS_SWEEP_TO_COLOR)})`,
      }}
    />
  );
}

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_COLOR_KEY_THRESHOLD,
  parseHeartbeatBandSpec,
  simulateHeartbeatLiveness,
} from "../lib/domain/broadcasting/broadcastHeartbeatLiveness";
import {
  minVisibleBandHeightVh,
  sweepsWithoutLeavingViewport,
} from "../lib/domain/broadcasting/broadcastHeartbeatSweep";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");
const css = readFileSync(join(here, "index.css"), "utf8");

describe("broadcast heartbeat band", () => {
  it("is painted by static HTML before the app root", () => {
    // アプリの JS（frontend.js）が読めなくても、HTML と CSS だけで
    // 帯は動き続ける。だから script の評価を介さない静的な div で、
    // アプリのマウント先より先に置く（issue #1001: 帯をアプリ配下に
    // 置いたままにすると、アプリの描画が落ちた時点で絵全体が止まる）。
    const bandIndex = html.indexOf('<div id="broadcast-heartbeat"');
    const rootIndex = html.indexOf('<div id="root"');
    expect(bandIndex).toBeGreaterThan(0);
    expect(rootIndex).toBeGreaterThan(bandIndex);
    expect(html).toMatch(
      /<div id="broadcast-heartbeat"[^>]*class="broadcast-heartbeat"/,
    );
    expect(html).toMatch(
      /<div id="broadcast-heartbeat"[^>]*aria-hidden="true"/,
    );
  });

  it("sweeps with the band always inside the viewport", () => {
    const heightMatch = css.match(
      /\.broadcast-heartbeat\s*{[^}]*height:\s*([\d.]+)vh/,
    );
    const fromMatch = css.match(
      /@keyframes broadcast-heartbeat-sweep\s*{[^}]*from\s*{[^}]*translateY\((-?[\d.]+)vh\)/,
    );
    const toMatch = css.match(
      /@keyframes broadcast-heartbeat-sweep\s*{[\s\S]*?to\s*{[^}]*translateY\((-?[\d.]+)vh\)/,
    );
    expect(heightMatch).not.toBeNull();
    expect(fromMatch).not.toBeNull();
    expect(toMatch).not.toBeNull();
    if (!heightMatch || !fromMatch || !toMatch) return;

    // 観測された静止の原因（issue #1001）: -12vh から 112vh の掃引は
    // 両端で帯を画面外に出し、その瞬間を含む 1 秒バケットの変化
    // フレームが足りない。画面内に残る高さが掃引のどこでも正で
    // あること（lib/domain/broadcasting/broadcastHeartbeatSweep.ts）。
    const sweep = {
      bandHeightVh: Number(heightMatch[1]),
      fromYvh: Number(fromMatch[1]),
      toYvh: Number(toMatch[1]),
    } as const;
    expect(sweepsWithoutLeavingViewport(sweep)).toBe(true);
    expect(minVisibleBandHeightVh(sweep)).toBeGreaterThan(0);
  });

  it("sweeps without a static hold", () => {
    expect(css).toContain("@keyframes broadcast-heartbeat-sweep");
    // `infinite` で待ちなく回す。`alternate` や一時停止があると、その間の
    // バケットが 0 枚になり外からの検知に停止と数えられる。
    expect(css).toMatch(
      /animation:\s*broadcast-heartbeat-sweep\s+2\.4s\s+linear\s+infinite/,
    );
    expect(css).not.toContain("animation-play-state");
  });

  it("keeps an opaque core that survives the black color key", () => {
    // OBS は Comment browser_source に黒色の Color Key を掛けている。
    // 半透明の白芯では暗く混ざって消され得るので、不透明な白を保つ。
    expect(css).toMatch(/rgba\(255,\s*255,\s*255,\s*1\)/);
    expect(css).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.6\)/);
  });

  it("keeps the delivered picture above the detector's thresholds", () => {
    // 帯が画面内に残っていても、帯 1 本だけで映像全体とゲーム領域が
    // 検知側の閾値（VIDEO_MIN_FPS 24 / GAME_MIN_FPS 8）を満たさないと
    // 「配信が止まった」と判定される。帯の仕様は CSS から読み、検知側と
    // 同じ計算で確かめる（詳細は lib/domain/broadcasting/
    // broadcastHeartbeatLiveness.ts と architecture/README.md）。
    const spec = parseHeartbeatBandSpec(css);
    const summary = simulateHeartbeatLiveness(spec, {
      colorKey: { threshold: DEFAULT_COLOR_KEY_THRESHOLD },
    });
    expect(summary.minFps).toBeGreaterThan(24);
    expect(summary.gameMinFps).toBeGreaterThan(8);
  });
});

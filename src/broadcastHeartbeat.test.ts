import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BROADCAST_HEARTBEAT_DEFAULT_GEOMETRY,
  evaluateBroadcastHeartbeat,
} from "../lib/domain/broadcasting/broadcastHeartbeat";

/**
 * 出荷するマークアップとスタイルが、検知の契約どおりに帯を動かすことを確かめる。
 *
 * 帯は React の描画にも CSS ファイルにも載せず、配信する HTML の中に静的に
 * 置いている（`src/index.html`）。バンドルの読み込みや描画の失敗、CSS の配信
 * やコンパイルの失敗で帯が止まると、合成出力が全フレーム同一になって停止と
 * 報告される（2026-10-22 12:30:56 JST: 音声と media clock が進んだまま
 * `videoMinFps = 0` / `gameMinFps = 0`）。
 */

const here = dirname(fileURLToPath(import.meta.url));
const geometry = BROADCAST_HEARTBEAT_DEFAULT_GEOMETRY;
const html = readFileSync(join(here, "index.html"), "utf8");
const css = readFileSync(join(here, "index.css"), "utf8");

/** HTML の中の静的スタイル。 */
const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

/** `.broadcast-heartbeat` の宣言ブロック。 */
const bandRule = style.match(/\.broadcast-heartbeat\s*\{([^}]*)\}/)?.[1] ?? "";

describe("the broadcast heartbeat markup and css", () => {
  it("ships the band as a static element outside the React root", () => {
    const body = html.slice(html.indexOf("<body>"), html.indexOf("</body>"));
    expect(body).toContain(
      '<div class="broadcast-heartbeat" aria-hidden="true"></div>',
    );
    // React が描画する `root` の中にない: バンドルの読み込みや描画の失敗で
    // 帯が消えないため。
    const rootContent = body.match(/<div id="root">([\s\S]*?)<\/div>/)?.[1];
    expect(rootContent).toBeDefined();
    expect(rootContent ?? "").not.toContain("broadcast-heartbeat");
  });

  it("does not depend on the stylesheet of the app", () => {
    // CSS ファイルの配信やコンパイルが失敗しても帯は動き続ける。帯の定義は
    // HTML の中だけに置く。
    expect(style).toContain("@keyframes broadcast-heartbeat-sweep");
    expect(css).not.toContain("broadcast-heartbeat");
  });

  it("keeps the band inside the picture", () => {
    const travel = style.match(
      /@keyframes\s+broadcast-heartbeat-sweep\s*\{[^}]*from\s*\{[^}]*\}\s*to\s*\{\s*transform:\s*translateY\((\d+)vh\)/,
    )?.[1];
    expect(travel).toBe(String(geometry.travelVh));
    expect(geometry.travelVh + geometry.bandHeightVh).toBeLessThanOrEqual(100);
  });

  it("sweeps fast enough for the checker to see the movement", () => {
    expect(bandRule).toMatch(
      new RegExp(`height:\\s*${geometry.bandHeightVh}vh`),
    );
    // 待ち無く回す。`alternate` や一時停止があると、その間の 1 秒バケットが
    // 0 枚になり外からの検知に停止と数えられる。
    expect(bandRule).toMatch(
      new RegExp(
        `animation:\\s*broadcast-heartbeat-sweep\\s+${geometry.sweepSeconds}s\\s+linear\\s+infinite`,
      ),
    );
    expect(style).not.toContain("animation-play-state");
  });

  it("satisfies the detection contract", () => {
    const evaluation = evaluateBroadcastHeartbeat(geometry);
    expect(evaluation.detectable).toBe(true);
    expect(evaluation.sampleRowsPerFrame).toBeGreaterThan(1);
  });
});

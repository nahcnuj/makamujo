import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BROADCAST_HEARTBEAT_BAND_SPEC } from "../lib/domain/broadcasting/broadcastHeartbeatLiveness";

/**
 * 配信映像の鼓動（帯）は `src/index.html` の静的な要素と `src/index.css` の
 * アニメーションで実装されている。帯の形は検知の閾値（`scripts/check-stream.ts`）
 * と 1 対 1 で対応していなければならないので、CSS が仕様とずれていないことを
 * ここで検査する。
 *
 * 帯を JS のツリーに置いていた以前は、アプリのマウントや再描画が例外で止まった
 * ときにオーバーレイごと静止していた（issue #1009）。静的な要素ならアプリの
 * 状態と無関係に動き続ける。
 */

const here = dirname(fileURLToPath(import.meta.url));

const html = readFileSync(join(here, "index.html"), "utf8");
const css = readFileSync(join(here, "index.css"), "utf8");
const app = readFileSync(join(here, "App.tsx"), "utf8");

/** CSS の規則を取り出す（閉じ括弧は行頭にある）。 */
const ruleBody = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matched = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  if (matched?.[1] === undefined) {
    throw new Error(`the CSS rule "${selector}" was not found`);
  }
  return matched[1];
};

/** `translateY(12vh)` のような値を取り出す。 */
const translateYOf = (body: string, keyframe: string): number => {
  const matched = new RegExp(
    `${keyframe}\\s*\\{\\s*transform:\\s*translateY\\((-?[\\d.]+)vh\\)`,
  ).exec(body);
  if (matched?.[1] === undefined) {
    throw new Error(`the ${keyframe} keyframe has no translateY`);
  }
  return Number.parseFloat(matched[1]);
};

type GradientStop = {
  color: { red: number; green: number; blue: number };
  alpha: number;
  percent: number;
};

/** `linear-gradient` の色 stops を取り出す。 */
const gradientStops = (body: string): GradientStop[] => {
  const gradient = /linear-gradient\(([\s\S]*?)\);/.exec(body)?.[1];
  if (gradient === undefined) {
    throw new Error("the band has no linear-gradient");
  }
  const stops: GradientStop[] = [];
  const pattern = /rgba?\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)\s+(\d+)%/g;
  for (const matched of gradient.matchAll(pattern)) {
    stops.push({
      color: {
        red: Number.parseInt(matched[1] ?? "0", 10),
        green: Number.parseInt(matched[2] ?? "0", 10),
        blue: Number.parseInt(matched[3] ?? "0", 10),
      },
      alpha: Number.parseFloat(matched[4] ?? "0"),
      percent: Number.parseFloat(matched[5] ?? "0"),
    });
  }
  if (stops.length === 0) {
    throw new Error("the band gradient has no color stops");
  }
  return stops;
};

describe("broadcastHeartbeat", () => {
  it("keeps the band out of the app tree", () => {
    // 静的な要素として置いてあるので、アプリのマウント先（#root）の外にあり、
    // App の JSX には現れない。
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain(
      '<div class="broadcast-heartbeat" aria-hidden="true"></div>',
    );
    expect(html.indexOf('class="broadcast-heartbeat"')).toBeGreaterThan(
      html.indexOf('id="root"'),
    );
    expect(app).not.toContain("broadcast-heartbeat");
  });

  it("sweeps the band as the spec describes", () => {
    const keyframes = ruleBody("@keyframes broadcast-heartbeat-sweep");
    const band = ruleBody(".broadcast-heartbeat");
    const height = Number.parseFloat(
      /height:\s*([\d.]+)vh/.exec(band)?.[1] ?? "0",
    );
    const duration = Number.parseFloat(
      /animation:\s*broadcast-heartbeat-sweep\s+([\d.]+)s/.exec(band)?.[1] ??
        "0",
    );
    expect(height / 100).toBe(BROADCAST_HEARTBEAT_BAND_SPEC.heightRatio);
    expect(duration * 1000).toBe(BROADCAST_HEARTBEAT_BAND_SPEC.durationMs);
    expect(translateYOf(keyframes, "from") / 100).toBe(
      BROADCAST_HEARTBEAT_BAND_SPEC.sweepFromRatio,
    );
    expect(translateYOf(keyframes, "to") / 100).toBe(
      BROADCAST_HEARTBEAT_BAND_SPEC.sweepToRatio,
    );
  });

  it("keeps the band moving without a static hold", () => {
    const band = ruleBody(".broadcast-heartbeat");
    // `infinite` で待ちなく回す。`alternate` の折り返しや一時停止があると、
    // その間のバケットが 0 枚になり外からの検知に停止と数えられる。
    expect(band).toMatch(
      /animation:\s*broadcast-heartbeat-sweep\s+[\d.]+s\s+linear\s+infinite/,
    );
    expect(band).not.toContain("animation-play-state");
    expect(css).not.toContain("animation-direction: alternate");
  });

  it("keeps an opaque core that the OBS color key cannot remove", () => {
    const band = ruleBody(".broadcast-heartbeat");
    const stops = gradientStops(band);
    const opaque = stops.filter((stop) => stop.alpha === 1);
    expect(opaque.length).toBeGreaterThanOrEqual(2);
    const first = opaque[0];
    const last = opaque[opaque.length - 1];
    if (first === undefined || last === undefined) {
      throw new Error("the band gradient has no opaque stop");
    }
    // 不透明な中核の高さは仕様どおり。
    const coreRatio =
      ((last.percent - first.percent) / 100) *
      BROADCAST_HEARTBEAT_BAND_SPEC.heightRatio;
    expect(coreRatio).toBeCloseTo(BROADCAST_HEARTBEAT_BAND_SPEC.coreRatio, 6);
    // 中核の縁の色（より暗い側）が仕様どおりの色。
    expect(first.color).toEqual(BROADCAST_HEARTBEAT_BAND_SPEC.coreColor);
    // 縁は透明。半透明だと Color Key に消される。
    expect(stops[0]?.alpha).toBe(0);
    expect(stops[stops.length - 1]?.alpha).toBe(0);
  });
});

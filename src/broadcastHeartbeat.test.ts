import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bandKeepsPictureMoving,
  parseHeartbeatBandSpec,
} from "../lib/domain/broadcasting/broadcastHeartbeatBand";
import { handleCatchAll } from "./catchAll";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "index.html"), "utf8");
const css = readFileSync(join(here, "index.css"), "utf8");

/** The picture OBS delivers: the Comment browser source is 1280x720. */
const VIEWPORT_HEIGHT_PX = 720;

describe("broadcast heartbeat", () => {
  it("is painted by the static HTML, before the app root", () => {
    // 帯はアプリの JS を経由しない。`frontend.js` の評価に失敗しても
    // HTML と CSS だけで動き続ける（issue #1005: アプリ側の描画が落ちると
    // オーバーレイごと絵が止まる）。
    const bandIndex = html.search(/<div[^>]*id="broadcast-heartbeat"/);
    const rootIndex = html.indexOf('<div id="root"');
    expect(bandIndex).toBeGreaterThan(0);
    expect(rootIndex).toBeGreaterThan(bandIndex);
    expect(html).toMatch(/id="broadcast-heartbeat"/);
    expect(html).toMatch(/class="broadcast-heartbeat"/);
    expect(html).toMatch(/aria-hidden="true"/);
  });

  it("serves the band to the browser source", async () => {
    const req = new Request("http://localhost/", {
      headers: { accept: "text/html" },
    });
    const res = await handleCatchAll(req);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('id="broadcast-heartbeat"');
    expect(body).toContain('class="broadcast-heartbeat"');
    expect(body.indexOf('id="broadcast-heartbeat"')).toBeLessThan(
      body.indexOf('<div id="root"'),
    );
  });

  it("keeps the delivered picture moving on its own", () => {
    // 帯が画面外に出ると 1 秒バケットの変化フレームが足りなくなり、
    // 「映像全体が停止している」と判定される（実測で videoMinFps 20）。
    const spec = parseHeartbeatBandSpec(css);
    expect(bandKeepsPictureMoving(spec, VIEWPORT_HEIGHT_PX)).toBe(true);
  });
});

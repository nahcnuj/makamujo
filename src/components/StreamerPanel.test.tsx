import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

describe("StreamerPanel keys", () => {
  it("keys speech rows by line text, not index (avoids remount after rise)", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "StreamerPanel.tsx"),
      "utf8",
    );
    // Index-based keys change from `2-${line}` to `1-${line}` after the rise
    // transition and remount SpeechLine, replaying speech-fade-in.
    expect(src).not.toContain(`key=\`\${i}-\${line}\``);
    expect(src).toContain("key={line}");
  });

  it("keeps the always-on ticker rail above the streamer row", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "StreamerPanel.tsx"),
      "utf8",
    );
    // scripts/check-stream.ts の映像停止誤検知（#868 ほか）対策。
    // リボンがないと下部パネルの上端に常時モーションが立たない。
    expect(src).toContain('import { TickerRail } from "./TickerRail"');
    expect(src).toContain("<TickerRail />");
  });
});

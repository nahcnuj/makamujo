import { describe, expect, it } from "bun:test";
import { shouldShowSilentCaption } from "./silentCaptionVisibility";

describe("shouldShowSilentCaption", () => {
  it("shows the floating caption while the agent is silent", () => {
    expect(shouldShowSilentCaption(true, 2)).toBe(true);
  });

  it("shows the floating caption when there is no speech line to display", () => {
    // 空の発話欄は完全に静止し、その間ゲームも止まっていると配信映像が
    // 全フレーム同一になる (issue #995)。
    expect(shouldShowSilentCaption(false, 0)).toBe(true);
  });

  it("hides the floating caption while speech lines are displayed", () => {
    expect(shouldShowSilentCaption(false, 1)).toBe(false);
  });
});

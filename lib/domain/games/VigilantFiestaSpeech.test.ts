import { describe, expect, it } from "bun:test";
import { planVigilantFiestaSpeeches } from "./VigilantFiestaSpeech";

describe("planVigilantFiestaSpeeches", () => {
  it("announces start when entering playing from title", () => {
    const lines = planVigilantFiestaSpeeches(
      { screen: "title", score: Number.NaN, level: Number.NaN },
      { screen: "playing", score: 0, level: 1 },
    );
    expect(lines).toContain("落ち物パズル、スタート！");
  });

  it("announces replay when entering playing from result", () => {
    const lines = planVigilantFiestaSpeeches(
      { screen: "result", score: 10, level: 2 },
      { screen: "playing", score: 0, level: 1 },
    );
    expect(lines).toContain("もう一回やってみます！");
  });

  it("announces level up", () => {
    const lines = planVigilantFiestaSpeeches(
      { screen: "playing", score: 40, level: 1 },
      { screen: "playing", score: 50, level: 2 },
    );
    expect(lines).toContain("レベル2になりました！");
  });

  it("announces score milestones once when crossed", () => {
    const lines = planVigilantFiestaSpeeches(
      { screen: "playing", score: 90, level: 1 },
      { screen: "playing", score: 120, level: 1 },
    );
    expect(lines.some((l) => l.includes("100"))).toBe(true);
  });

  it("announces game over with score and free-talk lead-in", () => {
    const lines = planVigilantFiestaSpeeches(
      { screen: "playing", score: 420, level: 3 },
      { screen: "result", score: 420, level: 3 },
    );
    expect(lines[0]).toContain("ゲームオーバー");
    expect(lines[0]).toContain("420");
    expect(lines).toContain("ちょっと雑談してから、またプレイしますね。");
  });

  it("returns empty when nothing meaningful changed", () => {
    const lines = planVigilantFiestaSpeeches(
      { screen: "playing", score: 10, level: 1 },
      { screen: "playing", score: 10, level: 1 },
    );
    expect(lines).toEqual([]);
  });
});

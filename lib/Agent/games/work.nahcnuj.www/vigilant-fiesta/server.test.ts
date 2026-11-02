import { describe, expect, it } from "bun:test";
import { buildSightResult, GAME_HOME_URL } from "./server";

describe("vigilant-fiesta buildSightResult", () => {
  it("parses score and level from HUD text", () => {
    const result = buildSightResult({
      screen: "playing",
      scoreText: "Score: 1,234",
      levelText: "Level: 5",
      url: GAME_HOME_URL,
      title: "落ち物パズルゲーム・蘇",
      selectedText: "",
      timestamp: 1,
    });
    expect(result.screen).toBe("playing");
    expect(result.score).toBe(1234);
    expect(result.level).toBe(5);
  });

  it("returns NaN when labels are missing", () => {
    const result = buildSightResult({
      screen: "title",
      scoreText: "",
      levelText: "",
      url: GAME_HOME_URL,
      title: "t",
      selectedText: "",
      timestamp: 0,
    });
    expect(Number.isNaN(result.score)).toBe(true);
    expect(Number.isNaN(result.level)).toBe(true);
  });
});

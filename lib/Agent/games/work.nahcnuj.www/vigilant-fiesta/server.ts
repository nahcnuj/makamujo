import type { ScreenName, State } from "./State";

export const DEFAULT_GAME_HOME_URL = "https://www.nahcnuj.work/vigilant-fiesta/";

/**
 * Home URL for open / redirect / away detection.
 * Override with `VIGILANT_FIESTA_HOME_URL` (e.g. local fixture in tests).
 */
export const getGameHomeUrl = (): string => {
  const fromEnv = process.env.VIGILANT_FIESTA_HOME_URL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_GAME_HOME_URL;
};

/** @deprecated Prefer getGameHomeUrl() so env overrides apply at call time. */
export const GAME_HOME_URL = DEFAULT_GAME_HOME_URL;

export type SightRawData = {
  screen: ScreenName;
  scoreText: string;
  levelText: string;
  url: string;
  title: string;
  selectedText: string;
  timestamp: number;
};

const parseHudNumber = (text: string, label: string): number => {
  const matched = text.match(new RegExp(`${label}\\s*:\\s*([\\d,]+)`, "i"));
  if (!matched?.[1]) return Number.NaN;
  return Number.parseInt(matched[1].replaceAll(",", ""), 10);
};

export const buildSightResult = (data: SightRawData): State => ({
  screen: data.screen,
  score: parseHudNumber(data.scoreText, "Score"),
  level: parseHudNumber(data.levelText, "Level"),
  scoreText: data.scoreText,
  levelText: data.levelText,
  url: data.url,
  title: data.title,
  selectedText: data.selectedText,
  timestamp: data.timestamp,
});

/**
 * Browser-side sight. Must stay self-contained for page.evaluate().
 */
export const sight = (): State => {
  const isVisible = (el: HTMLElement | null): boolean => {
    if (!el) return false;
    if (el.hasAttribute("hidden")) return false;
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true,
      });
    }
    return el.getClientRects().length > 0;
  };

  const screen: ScreenName = (() => {
    if (isVisible(document.getElementById("screen-title"))) return "title";
    if (isVisible(document.getElementById("result-overlay"))) return "result";
    if (isVisible(document.getElementById("screen-playing"))) return "playing";
    return "unknown";
  })();

  // Prefer innerText (layout-aware); fall back to textContent for environments
  // without layout (JSDOM) and for headless evaluation edge cases.
  const textOf = (el: HTMLElement | null): string => {
    if (!el) return "";
    const raw = (typeof el.innerText === "string" && el.innerText.length > 0)
      ? el.innerText
      : (el.textContent ?? "");
    return raw.trim();
  };

  // On result, prefer #result-score; while playing/title use #score only
  // (hidden result overlay still has text in the DOM).
  const scoreText = screen === "result"
    ? (textOf(document.getElementById("result-score")) || textOf(document.getElementById("score")))
    : textOf(document.getElementById("score"));
  const levelText = textOf(document.getElementById("level"));

  const parseHudNumber = (text: string, label: string): number => {
    const matched = text.match(new RegExp(`${label}\\s*:\\s*([\\d,]+)`, "i"));
    if (!matched?.[1]) return Number.NaN;
    return Number.parseInt(matched[1].replaceAll(",", ""), 10);
  };

  return {
    screen,
    score: parseHudNumber(scoreText, "Score"),
    level: parseHudNumber(levelText, "Level"),
    scoreText,
    levelText,
    url: location.href,
    title: document.title,
    selectedText: document.getSelection()?.toString() ?? "",
    timestamp: Date.now(),
  };
};

export { default as Component } from "./ReactComponent";
export { solver } from "./solver";

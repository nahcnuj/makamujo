export type ScreenName = "title" | "playing" | "result" | "unknown";

export type State = {
  screen: ScreenName;
  score: number;
  level: number;
  scoreText: string;
  levelText: string;
  url: string;
  title: string;
  selectedText: string;
  timestamp: number;
  /** Best score in this process / stream slot (枠内). */
  sessionBest?: number;
  /** Best score across restarts (通算). */
  allTimeBest?: number;
};

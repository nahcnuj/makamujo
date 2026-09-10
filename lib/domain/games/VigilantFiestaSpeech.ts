/**
 * Pure speech planning for 落ち物パズルゲーム・蘇 (vigilant-fiesta).
 * Application layer applies side effects (TTS / learn).
 */

export type VigilantFiestaSight = {
  screen?: unknown;
  score?: unknown;
  level?: unknown;
};

/** Score thresholds that trigger a one-shot milestone line. */
export const SCORE_MILESTONES = [
  100, 500, 1_000, 2_000, 5_000, 10_000,
] as const;

const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
};

const asScreen = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  return value;
};

const formatScore = (score: number): string =>
  new Intl.NumberFormat("ja-JP").format(Math.trunc(score));

/**
 * Diff previous vs next sight and return scripted utterances (may be empty).
 * Order is start → level-up → milestones → game-over.
 */
export const planVigilantFiestaSpeeches = (
  previous: VigilantFiestaSight | undefined,
  next: VigilantFiestaSight,
): readonly string[] => {
  const speeches: string[] = [];
  const prevScreen = asScreen(previous?.screen);
  const nextScreen = asScreen(next.screen);
  const prevScore = asFiniteNumber(previous?.score);
  const nextScore = asFiniteNumber(next.score);
  const prevLevel = asFiniteNumber(previous?.level);
  const nextLevel = asFiniteNumber(next.level);

  const enteredPlaying =
    nextScreen === "playing" &&
    prevScreen !== "playing" &&
    (prevScreen === "title" ||
      prevScreen === "result" ||
      prevScreen === undefined);

  if (enteredPlaying) {
    speeches.push(
      prevScreen === "result"
        ? "もう一回やってみます！"
        : "落ち物パズル、スタート！",
    );
  }

  if (
    nextScreen === "playing" &&
    nextLevel !== undefined &&
    prevLevel !== undefined &&
    nextLevel > prevLevel
  ) {
    speeches.push(`レベル${formatScore(nextLevel)}になりました！`);
  }

  if (nextScreen === "playing" && nextScore !== undefined) {
    const baseline = prevScore ?? 0;
    for (const milestone of SCORE_MILESTONES) {
      if (baseline < milestone && nextScore >= milestone) {
        speeches.push(`スコアが${formatScore(milestone)}点を超えました！`);
      }
    }
  }

  if (nextScreen === "result" && prevScreen !== "result") {
    if (nextScore !== undefined && Number.isFinite(nextScore)) {
      speeches.push(
        `ゲームオーバー！スコアは${formatScore(nextScore)}点でした。`,
      );
    } else {
      speeches.push("ゲームオーバー！");
    }
    speeches.push("ちょっと雑談してから、またプレイしますね。");
  }

  return speeches;
};

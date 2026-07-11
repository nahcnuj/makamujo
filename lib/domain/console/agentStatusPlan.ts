/**
 * Pure presentation plan for Agent Status console rows.
 * Keeps UI (JSX) out of domain decisions so row selection can be characterized without DOM.
 */

export type SpeechPayload =
  | string
  | { text?: string; nodes?: readonly string[] }
  | {
      speech?:
        | string
        | { text?: string; nodes?: readonly string[] }
        | { speech?: string; text?: string; nodes?: readonly string[] };
      silent?: boolean;
    }
  | undefined;

export type AgentStatusPlanInput = {
  niconama?: Record<string, unknown> | null;
  commentCount?: number;
  currentGame?: { name?: string; state?: Record<string, unknown> } | null;
  hasCurrentGameKey?: boolean;
  nGram?: number;
  nGramRaw?: number;
  speech?: SpeechPayload;
  speechHistory?: unknown[];
  replyTargetComment?: { text?: string; pickedTopic?: string };
  canSpeak?: boolean;
};

export type AgentStatusRowPlan =
  | { kind: "liveMetrics" }
  | { kind: "gameInfo" }
  | { kind: "nGram"; display: string }
  | { kind: "speechHistory"; emphasizeLatest: boolean }
  | { kind: "replyTargetOnly" }
  | { kind: "speechContent"; value: string }
  | { kind: "speechUnavailable" };

const UNIX_MILLISECONDS_THRESHOLD = 1_000_000_000_000;

export const SPEECH_UNAVAILABLE_INDICATOR = "（コメントしてね）";

export const normalizeSpeechText = (
  speech: SpeechPayload,
): string | undefined => {
  if (typeof speech === "string") {
    return speech.trim() || undefined;
  }
  if (speech && typeof speech === "object") {
    const record = speech as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text.trim() || undefined;
    }
    if (typeof record.speech === "string") {
      return record.speech.trim() || undefined;
    }
    if (record.speech && typeof record.speech === "object") {
      const nested = record.speech as Record<string, unknown>;
      if (typeof nested.text === "string") {
        return nested.text.trim() || undefined;
      }
    }
  }
  return undefined;
};

export const formatNGramValue = (
  nGram: number | undefined,
  nGramRaw: number | undefined,
): string => {
  if (nGram === undefined || !Number.isFinite(nGram) || nGram < 1) {
    return "-";
  }
  const nGramValue = `${Math.floor(nGram)}-gram`;
  if (nGramRaw === undefined || !Number.isFinite(nGramRaw) || nGramRaw < 1) {
    return nGramValue;
  }
  return `${nGramValue} (${Number(nGramRaw).toFixed(2)})`;
};

export const formatStateLabel = (type: string | undefined): string => {
  if (type === "live") return "配信中";
  if (type === "offline") return "停止中";
  return type ?? "-";
};

export const formatMetricValue = (metricValue: number | undefined): string =>
  metricValue === undefined ? "-" : String(metricValue);

export const formatStartDate = (
  startAtUnixTime: number | undefined,
): string => {
  if (
    typeof startAtUnixTime !== "number" ||
    !Number.isFinite(startAtUnixTime) ||
    startAtUnixTime <= 0
  ) {
    return "-";
  }
  const ms =
    startAtUnixTime >= UNIX_MILLISECONDS_THRESHOLD
      ? startAtUnixTime
      : startAtUnixTime * 1000;
  return new Date(ms).toLocaleString("ja-JP");
};

export const formatStreamStartTime = (
  startAtUnixTime: number | undefined,
): string | undefined => {
  if (
    typeof startAtUnixTime !== "number" ||
    !Number.isFinite(startAtUnixTime) ||
    startAtUnixTime <= 0
  ) {
    return undefined;
  }
  const ms =
    startAtUnixTime >= UNIX_MILLISECONDS_THRESHOLD
      ? startAtUnixTime
      : startAtUnixTime * 1000;
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} ${hour}:${minute} 開始`;
};

/**
 * Whether speech history would produce display items (mirrors createSpeechHistoryDisplayItems filters).
 */
export const hasDisplayableSpeechHistory = (
  speechHistory: unknown[] | undefined,
): boolean => {
  if (!Array.isArray(speechHistory) || speechHistory.length === 0) return false;
  return speechHistory.some((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as {
      speech?: SpeechPayload;
      nGram?: number;
      nodes?: unknown;
    };
    const speechText = normalizeSpeechText(row.speech);
    if (!speechText) return false;
    const hasTrace = Array.isArray(row.nodes) && row.nodes.length > 0;
    const hasValidNGram =
      row.nGram !== undefined &&
      Number.isFinite(row.nGram) &&
      (row.nGram as number) >= 1;
    return hasTrace || hasValidNGram;
  });
};

/**
 * Decide which Agent Status rows to show and their pure display values.
 * Order matches createAgentStatusRows (legacy).
 */
export const planAgentStatusRows = (
  input: AgentStatusPlanInput,
): AgentStatusRowPlan[] => {
  const plans: AgentStatusRowPlan[] = [];

  const niconamaState = input.niconama;
  if (niconamaState && Object.keys(niconamaState).length > 0) {
    plans.push({ kind: "liveMetrics" });
  }

  if (input.hasCurrentGameKey) {
    const currentGameName = input.currentGame?.name;
    const currentGameState = input.currentGame?.state;
    if (currentGameName !== undefined && currentGameState !== undefined) {
      plans.push({ kind: "gameInfo" });
    }
  }

  if (input.nGram !== undefined) {
    plans.push({
      kind: "nGram",
      display: formatNGramValue(input.nGram, input.nGramRaw),
    });
  }

  const replyTargetComment = input.replyTargetComment?.text
    ? input.replyTargetComment
    : undefined;
  const isSpeechSilent =
    input.speech !== undefined &&
    typeof input.speech === "object" &&
    (input.speech as { silent?: boolean }).silent === true;

  const historyPresent = hasDisplayableSpeechHistory(input.speechHistory);
  if (historyPresent) {
    plans.push({ kind: "speechHistory", emphasizeLatest: !isSpeechSilent });
  } else if (replyTargetComment) {
    plans.push({ kind: "replyTargetOnly" });
  }

  const normalizedSpeechText = normalizeSpeechText(input.speech);
  // Legacy: compare against first history item speech text when history exists —
  // callers pass firstHistorySpeechText when available for exact parity.
  const firstHistorySpeechText =
    input.speechHistory && input.speechHistory.length > 0
      ? normalizeSpeechText(
          typeof (input.speechHistory[0] as { speech?: SpeechPayload })
            ?.speech === "object" ||
            typeof (input.speechHistory[0] as { speech?: SpeechPayload })
              ?.speech === "string"
            ? (input.speechHistory[0] as { speech?: SpeechPayload }).speech
            : undefined,
        )
      : undefined;

  const shouldRenderSpeechContent =
    input.canSpeak === false ||
    (normalizedSpeechText !== undefined && !historyPresent) ||
    (normalizedSpeechText !== undefined &&
      firstHistorySpeechText !== normalizedSpeechText);

  if (!isSpeechSilent) {
    if (input.canSpeak === false) {
      plans.push({ kind: "speechUnavailable" });
    } else if (
      normalizedSpeechText !== undefined &&
      shouldRenderSpeechContent
    ) {
      plans.push({ kind: "speechContent", value: normalizedSpeechText });
    }
  }

  return plans;
};

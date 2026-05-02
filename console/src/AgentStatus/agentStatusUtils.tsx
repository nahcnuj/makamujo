import type { AgentStateResponse } from "./types";
import type { ReactNode } from "react";

const UNIX_MILLISECONDS_THRESHOLD = 1_000_000_000_000;
const GAME_STATE_EMPTY_ARRAY_LABEL = "(空の配列)";
const GAME_STATE_EMPTY_OBJECT_LABEL = "(空のオブジェクト)";
const SPEECH_UNAVAILABLE_INDICATOR = "・・・";

export const formatStateLabel = (type: string | undefined): string => {
  if (type === "live") {
    return "配信中";
  }
  if (type === "offline") {
    return "停止中";
  }
  return type ?? "-";
};

export const formatStartDate = (startAtUnixTime: number | undefined): string => {
  if (typeof startAtUnixTime !== "number" || !Number.isFinite(startAtUnixTime) || startAtUnixTime <= 0) {
    return "-";
  }
  const startAtUnixTimeMilliseconds = startAtUnixTime >= UNIX_MILLISECONDS_THRESHOLD
    ? startAtUnixTime
    : startAtUnixTime * 1000;
  return new Date(startAtUnixTimeMilliseconds).toLocaleString("ja-JP");
};

export const formatStreamStartTime = (startAtUnixTime: number | undefined): string | undefined => {
  if (typeof startAtUnixTime !== "number" || !Number.isFinite(startAtUnixTime) || startAtUnixTime <= 0) {
    return undefined;
  }
  const startAtUnixTimeMilliseconds = startAtUnixTime >= UNIX_MILLISECONDS_THRESHOLD
    ? startAtUnixTime
    : startAtUnixTime * 1000;
  const date = new Date(startAtUnixTimeMilliseconds);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} ${hour}:${minute} 開始`;
};

export const formatMetricValue = (metricValue: number | undefined): string => {
  return metricValue === undefined ? "-" : String(metricValue);
};

export const formatNGramValue = (nGram: number | undefined, nGramRaw: number | undefined): string => {
  if (nGram === undefined || !Number.isFinite(nGram) || nGram < 1) {
    return "-";
  }
  const nGramValue = `${Math.floor(nGram)}-gram`;
  if (nGramRaw === undefined || !Number.isFinite(nGramRaw) || nGramRaw < 1) {
    return nGramValue;
  }
  const formattedRaw = Number(nGramRaw).toFixed(2);
  return `${nGramValue} (${formattedRaw})`;
};

type SpeechPayload =
  | string
  | { text?: string; nodes?: readonly string[] }
  | ({ speech?: string | { text?: string; nodes?: readonly string[] } | { speech?: string; text?: string; nodes?: readonly string[] }; silent?: boolean })
  | undefined;

export const normalizeSpeechText = (speech: SpeechPayload): string | undefined => {
  if (typeof speech === "string") {
    return speech.trim() || undefined;
  }

  if (speech && typeof speech === "object") {
    const textValue = typeof (speech as any).text === "string"
      ? (speech as any).text
      : typeof (speech as any).speech === "string"
        ? (speech as any).speech
        : typeof (speech as any).speech === "object"
          ? typeof (speech as any).speech.text === "string"
            ? (speech as any).speech.text
            : undefined
          : undefined;
    return typeof textValue === "string" ? textValue.trim() || undefined : undefined;
  }

  return undefined;
};

const formatSpeechHistoryNGramLabel = (nGram: number | undefined): string => {
  if (nGram === undefined || !Number.isFinite(nGram) || nGram < 1) {
    return "-";
  }
  return `n=${Math.floor(nGram)}`;
};

const EMPHASIZED_SPEECH_HISTORY_BORDER_BOTTOM_WIDTH = "3px";

const formatSpeechHistoryItemText = (speechText: string, nGram: number | undefined): string => {
  return `${speechText} (${formatSpeechHistoryNGramLabel(nGram)})`;
};

export const createSpeechHistoryDisplayItems = (
  speechHistory: AgentStateResponse["speechHistory"] | undefined,
): Array<{ id: string; speechText: string; displayLine: string; nGramLabel: string; nodes?: string[] }> => {
  if (!Array.isArray(speechHistory)) {
    return [];
  }

  const speechHistoryItems = speechHistory.reduce<
    Array<{ id: string; speechText: string; displayLine: string; nGramLabel: string; nodes?: string[] }>
  >((accumulatedItems, speechHistoryItem) => {
    const speechText = normalizeSpeechText(speechHistoryItem.speech);
    if (!speechText) {
      return accumulatedItems;
    }

    const traceNodes = (speechHistoryItem as any).nodes;
    const hasTrace = Array.isArray(traceNodes) && traceNodes.length > 0;
    const hasValidNGram = speechHistoryItem.nGram !== undefined && Number.isFinite(speechHistoryItem.nGram) && speechHistoryItem.nGram >= 1;
    if (!hasTrace && !hasValidNGram) {
      return accumulatedItems;
    }

    const displayOrder = accumulatedItems.length + 1;
    accumulatedItems.push({
      id: speechHistoryItem.id ?? `speech-history-${displayOrder}`,
      speechText,
      displayLine: formatSpeechHistoryItemText(speechText, speechHistoryItem.nGram),
      nGramLabel: formatSpeechHistoryNGramLabel(speechHistoryItem.nGram),
      nodes: hasTrace ? (traceNodes as string[]) : undefined,
    });
    return accumulatedItems;
  }, []);

  const itemsWithSeq = speechHistoryItems.map((item) => {
    const match = item.id.match(/(\d+)$/);
    return { ...item, seq: match ? Number(match[1]) : undefined };
  });

  const seqCount = itemsWithSeq.reduce((c, it) => (it.seq !== undefined ? c + 1 : c), 0);
  if (seqCount >= 2) {
    itemsWithSeq.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
    return itemsWithSeq.map(({ seq, ...rest }) => rest);
  }

  return itemsWithSeq.map(({ seq, ...rest }) => rest);
};

export const createSpeechHistoryValueComponent = (
  speechHistory: AgentStateResponse["speechHistory"] | undefined,
): ReactNode => {
  const speechHistoryItems = createSpeechHistoryDisplayItems(speechHistory);
  if (speechHistoryItems.length === 0) {
    return <span>-</span>;
  }
  return (
    <ul className="grid grid-cols-1 gap-2 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
      {speechHistoryItems.map((speechHistoryItem, index) => (
        <li
          key={speechHistoryItem.id}
          className={index === 0
            ? "rounded-md border border-emerald-300/30 border-b border-b-emerald-300/80 p-2"
            : "rounded-md border border-emerald-300/30 p-2"
          }
          style={index === 0 ? {
            "--speech-history-border-bottom-width": EMPHASIZED_SPEECH_HISTORY_BORDER_BOTTOM_WIDTH,
            borderBottomWidth: "var(--speech-history-border-bottom-width)",
            paddingBottom: "calc(0.5rem - var(--speech-history-border-bottom-width))",
          } as React.CSSProperties : undefined}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-2">
            <div className="flex flex-wrap gap-1">
              {speechHistoryItem.nodes && Array.isArray(speechHistoryItem.nodes)
                ? speechHistoryItem.nodes.map((word, wi) => (
                  <span
                    key={`${speechHistoryItem.id}-node-${wi}`}
                    className="speech-word-chip inline-block rounded-md border border-emerald-300/30 bg-emerald-950/40 px-2 py-1 text-sm"
                  >
                    {word}
                  </span>
                ))
                : speechHistoryItem.speechText.split(/\s+/).map((word, wi) => (
                  <span
                    key={`${speechHistoryItem.id}-word-${wi}`}
                    className="speech-word-chip inline-block rounded-md border border-emerald-300/30 bg-emerald-950/40 px-2 py-1 text-sm"
                  >
                    {word}
                  </span>
                ))}
            </div>
            <span className="text-xs whitespace-nowrap">{speechHistoryItem.nGramLabel}</span>
            <button
              type="button"
              disabled
              aria-label="学習の取り消し"
              title="学習の取り消し"
              className="inline-flex items-center justify-center h-7 min-w-[2rem] rounded-md border border-emerald-300/50 bg-emerald-950/20 px-2 text-sm text-emerald-200 opacity-70 cursor-not-allowed shadow-sm shadow-black/20"
              style={{
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
                fontVariantEmoji: "text",
              }}
            >
              ↩
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
};

export const createLiveDeliveryMetricsValueComponent = (
  niconamaState: AgentStateResponse["niconama"],
): ReactNode => {
  const liveMetricItems = [
    { label: "状態", value: formatStateLabel(niconamaState?.type) },
    { label: "視聴者数", value: formatMetricValue(niconamaState?.meta?.total?.listeners) },
    { label: "コメント数", value: formatMetricValue(niconamaState?.meta?.total?.comments) },
    { label: "ギフト", value: formatMetricValue(niconamaState?.meta?.total?.gift) },
    { label: "広告", value: formatMetricValue(niconamaState?.meta?.total?.ad) },
  ];

  return (
    <div className="rounded-md border border-emerald-300/30 p-2">
      <div className="grid grid-cols-5 gap-x-2 gap-y-1">
        {liveMetricItems.map((liveMetricItem) => (
          <p key={liveMetricItem.label} className="font-bold text-center whitespace-nowrap">
            {liveMetricItem.label}
          </p>
        ))}
        {liveMetricItems.map((liveMetricItem) => (
          <p key={`${liveMetricItem.label}-value`} className="text-center whitespace-nowrap">
            {liveMetricItem.value}
          </p>
        ))}
      </div>
    </div>
  );
};

const formatCurrentGameStateLeafValue = (stateValue: unknown): string => {
  if (stateValue === null) {
    return "null";
  }
  if (stateValue === undefined) {
    return "-";
  }
  return String(stateValue);
};

const renderCurrentGameStateValueComponent = (
  currentGameStateValue: unknown,
  visitedObjects = new WeakSet<object>(),
): React.ReactNode => {
  if (currentGameStateValue === null || typeof currentGameStateValue !== "object") {
    return <span>{formatCurrentGameStateLeafValue(currentGameStateValue)}</span>;
  }

  if (visitedObjects.has(currentGameStateValue)) {
    throw new TypeError("Cannot render currentGame.state because circular references were detected (will display '-'.");
  }

  visitedObjects.add(currentGameStateValue);
  try {
    if (Array.isArray(currentGameStateValue)) {
      if (currentGameStateValue.length === 0) {
        return <span>{GAME_STATE_EMPTY_ARRAY_LABEL}</span>;
      }
      return (
        <ul className="list-disc pl-5 space-y-1">
          {currentGameStateValue.map((arrayItem, arrayIndex) => {
            const arrayItemKey =
              arrayItem !== null && typeof arrayItem === "object"
                ? `array-item-object-${arrayIndex}`
                : `array-item-${formatCurrentGameStateLeafValue(arrayItem)}-${arrayIndex}`;
            return <li key={arrayItemKey}>{renderCurrentGameStateValueComponent(arrayItem, visitedObjects)}</li>;
          })}
        </ul>
      );
    }

    const objectEntries = Object.entries(currentGameStateValue);
    if (objectEntries.length === 0) {
      return <span>{GAME_STATE_EMPTY_OBJECT_LABEL}</span>;
    }

    return (
      <ul className="space-y-1">
        {objectEntries.map(([stateKey, stateValue]) => {
          if (stateValue !== null && typeof stateValue === "object") {
            return (
              <li key={stateKey}>
                <div className="font-semibold">{stateKey}</div>
                <div className="pl-4 border-l border-emerald-300/40">
                  {renderCurrentGameStateValueComponent(stateValue, visitedObjects)}
                </div>
              </li>
            );
          }
          return (
            <li key={stateKey}>
              <span className="font-semibold">{stateKey}</span>
              <span>: {formatCurrentGameStateLeafValue(stateValue)}</span>
            </li>
          );
        })}
      </ul>
    );
  } finally {
    visitedObjects.delete(currentGameStateValue as object);
  }
};

export const createCurrentGameInfoValueComponent = (
  currentGameState: Record<string, unknown> | undefined,
): ReactNode => {
  if (currentGameState === undefined) {
    return <span>-</span>;
  }

  try {
    return renderCurrentGameStateValueComponent(currentGameState);
  } catch {
    return <span>-</span>;
  }
};

export const getSpeechUnavailableIndicator = (): string => SPEECH_UNAVAILABLE_INDICATOR;

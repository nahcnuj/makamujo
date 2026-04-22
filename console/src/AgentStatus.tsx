import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { GAME_SECTION_TITLE, GameStatusSection } from "./agentStatusSections/GameStatusSection";
import { LIVE_DELIVERY_SECTION_TITLE, LiveDeliveryStatusSection } from "./agentStatusSections/LiveDeliveryStatusSection";
import { MARKOV_MODEL_SECTION_TITLE, MarkovModelStatusSection } from "./agentStatusSections/MarkovModelStatusSection";
import type { AgentStatusRow } from "./agentStatusSections/AgentStatusSectionCard";
import { cloneAgentStateResponseMockFixture } from "../../tests/fixtures/agentStateResponseMock";

/**
 * Response schema returned by `/console/api/agent-state`.
 * `error` is populated when the proxy endpoint returns a non-200 response.
 */
type AgentStateResponse = {
  error?: string
  niconama?: {
    type?: string
    meta?: {
      title?: string
      url?: string
      start?: number
      total?: {
        listeners?: number
        gift?: number
        ad?: number
        comments?: number
      }
    }
  }
  canSpeak?: boolean
  currentGame?: {
    name?: string
    state?: Record<string, unknown>
  } | null
  nGram?: number
  nGramRaw?: number
  speech?: {
    speech?: string
    silent?: boolean
  }
  speechHistory?: Array<{
    id?: string
    speech?: string
    nGram?: number
    nGramRaw?: number
  }>
};

type AgentStatusSection = {
  title: string
  rows: AgentStatusRow[]
};

export const AGENT_STATE_REFRESH_INTERVAL_MS = 1_000;
export const AGENT_STATE_MOCK_NOTICE_MESSAGE = "配信エージェント状態モックを表示中";
const AGENT_STATE_MOCK_QUERY_KEY = "agentStateMock";
const INVALID_AGENT_STATE_RESPONSE_ERROR = "配信状態の応答形式が不正です。";
const SPEECH_UNAVAILABLE_INDICATOR = "・・・";
// Distinguishes unix seconds from unix milliseconds by treating 13-digit values as milliseconds.
const UNIX_MILLISECONDS_THRESHOLD = 1_000_000_000_000;
const MAX_SPEECH_HISTORY_ITEMS = 10;
const LIVE_DELIVERY_ROW_LABELS = ["配信指標", "タイトル", "配信URL", "開始時刻"] as const;
const MARKOV_MODEL_ROW_LABELS = ["生成N-gram", "発話内容", "これまでの発話"] as const;
const GAME_ROW_LABELS = ["現在のゲーム", "ゲーム情報"] as const;
const GAME_STATE_EMPTY_ARRAY_LABEL = "(空の配列)";
const GAME_STATE_EMPTY_OBJECT_LABEL = "(空のオブジェクト)";
// 上から順に: 上部固定領域（見出し・更新時刻・通知類）/ 詳細一覧（残り高さをすべて使用）
const AGENT_STATUS_GRID_ROW_TEMPLATE_CLASS = "grid-rows-[auto_minmax(0,1fr)]";
const createLabelSet = (labels: readonly string[]) => new Set<string>(labels);
const LIVE_DELIVERY_ROW_LABEL_SET = createLabelSet(LIVE_DELIVERY_ROW_LABELS);
const MARKOV_MODEL_ROW_LABEL_SET = createLabelSet(MARKOV_MODEL_ROW_LABELS);
const GAME_ROW_LABEL_SET = createLabelSet(GAME_ROW_LABELS);

export const createMockAgentStateResponse = (): AgentStateResponse => cloneAgentStateResponseMockFixture();

export const isAgentStateMockQueryEnabled = (searchParams: string): boolean => {
  return new URLSearchParams(searchParams).get(AGENT_STATE_MOCK_QUERY_KEY) === "1";
};

export const shouldUseMockAgentState = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  return isAgentStateMockQueryEnabled(window.location.search);
};

/**
 * Starts periodic refresh polling and returns a cleanup function.
 * `refreshIntervalMs` is overrideable for tests.
 */
export const startAgentStateAutoRefresh = (
  fetchAgentState: () => Promise<void>,
  refreshIntervalMs = AGENT_STATE_REFRESH_INTERVAL_MS,
) => {
  let isFetching = false;
  const intervalId = setInterval(() => {
    if (isFetching) {
      return;
    }

    isFetching = true;
    void fetchAgentState()
      .catch(() => undefined)
      .finally(() => {
        isFetching = false;
      });
  }, refreshIntervalMs);
  return () => {
    clearInterval(intervalId);
  };
};

export const parseAgentStateResponse = (responseText: string): AgentStateResponse => {
  try {
    return JSON.parse(responseText) as AgentStateResponse;
  } catch {
    throw new SyntaxError(INVALID_AGENT_STATE_RESPONSE_ERROR);
  }
};

const formatStateLabel = (type: string | undefined): string => {
  if (type === "live") {
    return "配信中";
  }
  if (type === "offline") {
    return "停止中";
  }
  return type ?? "-";
};

const formatStartDate = (startAtUnixTime: number | undefined): string => {
  if (typeof startAtUnixTime !== "number" || !Number.isFinite(startAtUnixTime) || startAtUnixTime <= 0) {
    return "-";
  }
  const startAtUnixTimeMilliseconds = startAtUnixTime >= UNIX_MILLISECONDS_THRESHOLD
    ? startAtUnixTime
    : startAtUnixTime * 1000;
  return new Date(startAtUnixTimeMilliseconds).toLocaleString("ja-JP");
};

const formatMetricValue = (metricValue: number | undefined): string => {
  return metricValue === undefined ? "-" : String(metricValue);
};

const formatNGramValue = (nGram: number | undefined, nGramRaw: number | undefined): string => {
  if (nGram === undefined || !Number.isFinite(nGram) || nGram < 1) {
    return "-";
  }
  const nGramValue = `${Math.floor(nGram)}-gram`;
  if (nGramRaw === undefined || !Number.isFinite(nGramRaw) || nGramRaw < 1) {
    return nGramValue;
  }
  return `${nGramValue} (${nGramRaw})`;
};

const formatSpeechHistoryItemText = (
  speechText: string,
  nGram: number | undefined,
): string => {
  return `${speechText} (${formatSpeechHistoryNGramLabel(nGram)})`;
};

const formatSpeechHistoryNGramLabel = (nGram: number | undefined): string => {
  if (nGram === undefined || !Number.isFinite(nGram) || nGram < 1) {
    return "-";
  }
  return `${Math.floor(nGram)}g`;
};

const createSpeechHistoryDisplayItems = (
  speechHistory: AgentStateResponse["speechHistory"] | undefined,
): Array<{ id: string; speechText: string; displayLine: string; nGramLabel: string }> => {
  if (!Array.isArray(speechHistory)) {
    return [];
  }
  const speechHistoryItems = speechHistory.reduce<Array<{ id: string; speechText: string; displayLine: string; nGramLabel: string }>>(
    (accumulatedItems, speechHistoryItem) => {
      const speechText = speechHistoryItem.speech?.trim();
      if (!speechText) {
        return accumulatedItems;
      }
      const displayOrder = accumulatedItems.length + 1;
      accumulatedItems.push({
        id: speechHistoryItem.id ?? `speech-history-${displayOrder}`,
        speechText,
        displayLine: formatSpeechHistoryItemText(speechText, speechHistoryItem.nGram),
        nGramLabel: formatSpeechHistoryNGramLabel(speechHistoryItem.nGram),
      });
      return accumulatedItems;
    },
    [],
  );
  return speechHistoryItems.slice(-MAX_SPEECH_HISTORY_ITEMS);
};

const createSpeechHistoryValueComponent = (
  speechHistory: AgentStateResponse["speechHistory"] | undefined,
): ReactNode => {
  const speechHistoryItems = createSpeechHistoryDisplayItems(speechHistory);
  if (speechHistoryItems.length === 0) {
    return <span>-</span>;
  }
  return (
    <ul className="grid grid-cols-2 gap-2">
      {speechHistoryItems.map((speechHistoryItem) => (
        <li key={speechHistoryItem.id} className="rounded-md border border-emerald-300/30 p-2">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2">
            <p className="break-words">{speechHistoryItem.speechText}</p>
            <span className="text-xs text-emerald-200 whitespace-nowrap">{speechHistoryItem.nGramLabel}</span>
            <button
              type="button"
              disabled
              aria-label="学習の取り消し"
              title="学習の取り消し"
              className="text-base leading-none h-7 w-7 rounded border border-emerald-300/50 text-emerald-200 opacity-70 cursor-not-allowed flex items-center justify-center"
            >
              ↩
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
};

const createLiveMetricItemComponent = (label: string, value: string): ReactNode => {
  return (
    <div className="rounded-md border border-emerald-300/30 p-2">
      <p>
        <span className="font-bold">{label}:</span> {value}
      </p>
    </div>
  );
};

const createLiveDeliveryMetricsValueComponent = (niconamaState: AgentStateResponse["niconama"]): ReactNode => {
  return (
    <div className="grid grid-cols-3 gap-2">
      {createLiveMetricItemComponent("状態", formatStateLabel(niconamaState?.type))}
      {createLiveMetricItemComponent("視聴者数", formatMetricValue(niconamaState?.meta?.total?.listeners))}
      {createLiveMetricItemComponent("ギフト", formatMetricValue(niconamaState?.meta?.total?.gift))}
      {createLiveMetricItemComponent("広告", formatMetricValue(niconamaState?.meta?.total?.ad))}
      {createLiveMetricItemComponent("コメント数", formatMetricValue(niconamaState?.meta?.total?.comments))}
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

/**
 * Renders `currentGame.state` as nested list components so users can visually
 * understand object/array structure. Circular references are detected via WeakSet
 * and treated as display failures by callers.
 *
 * @param currentGameStateValue - State value to render (object, array, primitive).
 * @param visitedObjects - WeakSet used to detect circular references during recursion.
 * @throws {TypeError} When a circular reference is found in the current traversal path.
 */
const renderCurrentGameStateValueComponent = (
  currentGameStateValue: unknown,
  // Uses a fresh WeakSet per top-level render to keep cycle detection scoped to one tree walk.
  visitedObjects = new WeakSet<object>(),
): ReactNode => {
  if (currentGameStateValue === null || typeof currentGameStateValue !== "object") {
    return <span>{formatCurrentGameStateLeafValue(currentGameStateValue)}</span>;
  }

  if (visitedObjects.has(currentGameStateValue)) {
    throw new TypeError("Cannot render currentGame.state because circular references were detected (will display '-').");
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
    visitedObjects.delete(currentGameStateValue);
  }
};

/**
 * Creates a safe UI value component for the game info row.
 * Returns `-` component when state is missing or cannot be rendered.
 */
const createCurrentGameInfoValueComponent = (currentGameState: Record<string, unknown> | undefined): ReactNode => {
  if (currentGameState === undefined) {
    return <span>-</span>;
  }

  try {
    return renderCurrentGameStateValueComponent(currentGameState);
  } catch {
    return <span>-</span>;
  }
};

/**
 * Converts agent-state payload into user-facing rows for the status details UI.
 */
export const createAgentStatusRows = (stateResponse: AgentStateResponse | null): AgentStatusRow[] => {
  const rows: AgentStatusRow[] = [];

  const niconamaState = stateResponse?.niconama;
  if (niconamaState && Object.keys(niconamaState).length > 0) {
    rows.push(
      { label: "配信指標", hideLabel: true, valueComponent: createLiveDeliveryMetricsValueComponent(niconamaState) },
      { label: "タイトル", value: niconamaState.meta?.title ?? "-" },
      { label: "配信URL", value: niconamaState.meta?.url ?? "-", href: niconamaState.meta?.url },
      { label: "開始時刻", value: formatStartDate(niconamaState.meta?.start) },
    );
  }

  if (stateResponse !== null && stateResponse !== undefined && "currentGame" in stateResponse) {
    rows.push({ label: "現在のゲーム", value: stateResponse.currentGame?.name ?? "-" });
    rows.push({
      label: "ゲーム情報",
      valueComponent: createCurrentGameInfoValueComponent(stateResponse.currentGame?.state),
    });
  }

  if (stateResponse?.nGram !== undefined) {
    rows.push({ label: "生成N-gram", value: formatNGramValue(stateResponse.nGram, stateResponse.nGramRaw) });
  }

  if (createSpeechHistoryDisplayItems(stateResponse?.speechHistory).length > 0) {
    rows.push({
      label: "これまでの発話",
      valueComponent: createSpeechHistoryValueComponent(stateResponse?.speechHistory),
    });
  }

  if (stateResponse?.canSpeak === false) {
    rows.push({ label: "発話内容", value: SPEECH_UNAVAILABLE_INDICATOR });
  } else if (stateResponse?.speech !== undefined) {
    rows.push({ label: "発話内容", value: stateResponse.speech.speech ?? "-" });
  }

  return rows;
};

export const createAgentStatusSections = (stateResponse: AgentStateResponse | null): AgentStatusSection[] => {
  const rows = createAgentStatusRows(stateResponse);
  const liveDeliveryRows = rows.filter((row) => LIVE_DELIVERY_ROW_LABEL_SET.has(row.label));
  const markovModelRows = rows.filter((row) => MARKOV_MODEL_ROW_LABEL_SET.has(row.label));
  const gameRows = rows.filter((row) => GAME_ROW_LABEL_SET.has(row.label));

  const sections = [
    { title: LIVE_DELIVERY_SECTION_TITLE, rows: liveDeliveryRows },
    { title: MARKOV_MODEL_SECTION_TITLE, rows: markovModelRows },
    { title: GAME_SECTION_TITLE, rows: gameRows },
  ];

  return sections.filter((section) => section.rows.length > 0);
};

export function AgentStatus() {
  const [agentStateResponse, setAgentStateResponse] = useState<AgentStateResponse | null>(null);
  const [agentStatusError, setAgentStatusError] = useState<string | null>(null);
  const [lastUpdatedTime, setLastUpdatedTime] = useState("");
  const [isLoadingAgentState, setIsLoadingAgentState] = useState(false);
  const [isShowingMockAgentState, setIsShowingMockAgentState] = useState(false);

  const fetchAgentState = useCallback(async () => {
    setIsLoadingAgentState(true);
    try {
      if (shouldUseMockAgentState()) {
        setAgentStateResponse(createMockAgentStateResponse());
        setAgentStatusError(null);
        setIsShowingMockAgentState(true);
        setLastUpdatedTime(new Date().toLocaleTimeString("ja-JP"));
        return;
      }

      const response = await fetch("/console/api/agent-state");
      const responseText = await response.text();
      if (!response.ok) {
        let errorMessageFromResponse: string | null = null;
        try {
          const responseData = parseAgentStateResponse(responseText);
          errorMessageFromResponse = responseData.error ?? null;
        } catch {
          errorMessageFromResponse = null;
        }
        throw new Error(errorMessageFromResponse ?? `配信状態の取得に失敗しました (${response.status})`);
      }

      const responseData = parseAgentStateResponse(responseText);
      setAgentStateResponse(responseData);
      setAgentStatusError(null);
      setIsShowingMockAgentState(false);
      setLastUpdatedTime(new Date().toLocaleTimeString("ja-JP"));
    } catch (error) {
      const errorMessage =
        error instanceof SyntaxError
          ? INVALID_AGENT_STATE_RESPONSE_ERROR
          : error instanceof Error
            ? error.message
            : String(error);
      setAgentStatusError(errorMessage);
      setAgentStateResponse(null);
      setIsShowingMockAgentState(false);
      setLastUpdatedTime(new Date().toLocaleTimeString("ja-JP"));
    } finally {
      setIsLoadingAgentState(false);
    }
  }, []);

  useEffect(() => {
    void fetchAgentState();
    return startAgentStateAutoRefresh(fetchAgentState);
  }, [fetchAgentState]);

  const agentStatusSections = createAgentStatusSections(agentStateResponse);
  const sectionMap = agentStatusSections.reduce<Partial<Record<AgentStatusSection["title"], AgentStatusSection>>>(
    (accumulatedSections, section) => {
      accumulatedSections[section.title] = section;
      return accumulatedSections;
    },
    {},
  );
  const liveDeliverySection = sectionMap[LIVE_DELIVERY_SECTION_TITLE];
  const markovModelSection = sectionMap[MARKOV_MODEL_SECTION_TITLE];
  const gameSection = sectionMap[GAME_SECTION_TITLE];

  return (
    <div className={`mx-auto w-full max-w-7xl h-full min-h-0 text-left grid ${AGENT_STATUS_GRID_ROW_TEMPLATE_CLASS} gap-4`}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">
            <a href="https://live.nicovideo.jp/watch/user/14171889" target="_blank" rel="noopener noreferrer">
              馬可無序
            </a>
          </h1>
          <p className="text-sm text-emerald-200 whitespace-nowrap">
            最終更新: {lastUpdatedTime || "未取得"}
          </p>
          <button
            type="button"
            onClick={fetchAgentState}
            disabled={isLoadingAgentState}
            className="bg-emerald-300 text-emerald-950 border-0 px-5 py-1.5 rounded-lg font-bold transition-all duration-100 hover:bg-emerald-200 hover:-translate-y-px cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
          >
            更新
          </button>
        </div>
        {isShowingMockAgentState ? (
          <div
            data-testid="agent-status-mock-notice"
            className="w-full bg-emerald-950/70 border-2 border-emerald-300 rounded-xl p-3 text-emerald-50"
          >
            {AGENT_STATE_MOCK_NOTICE_MESSAGE}
          </div>
        ) : null}
        {agentStatusError ? (
          <div
            data-testid="agent-status-error"
            className="w-full min-h-[80px] bg-red-950/60 border-2 border-red-300 rounded-xl p-3 text-red-100"
          >
            取得エラー: {agentStatusError}
          </div>
        ) : null}
      </div>
      {agentStatusSections.length === 0 ? (
        <div
          data-testid="agent-status-empty"
          className="w-full min-h-[80px] bg-emerald-950/70 border-2 border-emerald-300 rounded-xl p-3 text-emerald-50"
        >
          {isLoadingAgentState ? "読み込み中..." : "配信情報はありません。"}
        </div>
      ) : (
        <div
          data-testid="agent-status-details"
          className="w-full min-h-0 overflow-y-auto pr-1 grid grid-cols-1 lg:grid-cols-2 auto-rows-min gap-4"
        >
          {liveDeliverySection ? <LiveDeliveryStatusSection liveDeliveryRows={liveDeliverySection.rows} /> : null}
          {markovModelSection ? <MarkovModelStatusSection markovModelRows={markovModelSection.rows} /> : null}
          {gameSection ? <GameStatusSection gameRows={gameSection.rows} /> : null}
        </div>
      )}
    </div>
  );
}

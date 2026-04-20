import { useCallback, useEffect, useState } from "react";
import { GAME_SECTION_TITLE, GameStatusSection } from "./agentStatusSections/GameStatusSection";
import { LIVE_DELIVERY_SECTION_TITLE, LiveDeliveryStatusSection } from "./agentStatusSections/LiveDeliveryStatusSection";
import { MARKOV_MODEL_SECTION_TITLE, MarkovModelStatusSection } from "./agentStatusSections/MarkovModelStatusSection";
import type { AgentStatusRow } from "./agentStatusSections/AgentStatusSectionCard";

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
      }
    }
  }
  canSpeak?: boolean
  currentGame?: {
    name?: string
    state?: Record<string, unknown>
  } | null
  nGram?: number
  speech?: {
    speech?: string
    silent?: boolean
  }
};

type AgentStatusSection = {
  title: string
  rows: AgentStatusRow[]
};

export const AGENT_STATE_REFRESH_INTERVAL_MS = 5_000;
const AGENT_STATE_MOCK_QUERY_KEY = "agentStateMock";
const INVALID_AGENT_STATE_RESPONSE_ERROR = "配信状態の応答形式が不正です。";
// Distinguishes unix seconds from unix milliseconds by treating 13-digit values as milliseconds.
const UNIX_MILLISECONDS_THRESHOLD = 1_000_000_000_000;
const LIVE_DELIVERY_ROW_LABELS = ["状態", "タイトル", "配信URL", "開始時刻", "視聴者数", "ギフト", "広告"] as const;
const MARKOV_MODEL_ROW_LABELS = ["話せる状態", "生成N-gram", "発話内容"] as const;
const GAME_ROW_LABELS = ["現在のゲーム"] as const;
const createLabelSet = (labels: readonly string[]) => new Set<string>(labels);
const LIVE_DELIVERY_ROW_LABEL_SET = createLabelSet(LIVE_DELIVERY_ROW_LABELS);
const MARKOV_MODEL_ROW_LABEL_SET = createLabelSet(MARKOV_MODEL_ROW_LABELS);
const GAME_ROW_LABEL_SET = createLabelSet(GAME_ROW_LABELS);

export const createMockAgentStateResponse = (): AgentStateResponse => ({
  niconama: {
    type: "live",
    meta: {
      title: "配信エージェント状態モック",
      url: "https://example.com/watch/mock",
      start: 1_717_000_000,
      total: {
        listeners: 123,
        gift: 456,
        ad: 789,
      },
    },
  },
  canSpeak: true,
  currentGame: {
    name: "org.dashnet.orteil/cookieclicker",
    state: {
      status: "idle",
    },
  },
  nGram: 4,
  speech: {
    speech: "コメントを学習してお話ししています",
    silent: false,
  },
});

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

const formatNGramValue = (nGram: number | undefined): string => {
  if (nGram === undefined || !Number.isFinite(nGram) || nGram < 1) {
    return "-";
  }
  return `${Math.floor(nGram)}-gram`;
};

/**
 * Converts agent-state payload into user-facing rows for the status details UI.
 */
export const createAgentStatusRows = (stateResponse: AgentStateResponse | null): AgentStatusRow[] => {
  const rows: AgentStatusRow[] = [];

  const niconamaState = stateResponse?.niconama;
  if (niconamaState && Object.keys(niconamaState).length > 0) {
    rows.push(
      { label: "状態", value: formatStateLabel(niconamaState.type) },
      { label: "タイトル", value: niconamaState.meta?.title ?? "-" },
      { label: "配信URL", value: niconamaState.meta?.url ?? "-", href: niconamaState.meta?.url },
      { label: "開始時刻", value: formatStartDate(niconamaState.meta?.start) },
      { label: "視聴者数", value: formatMetricValue(niconamaState.meta?.total?.listeners) },
      { label: "ギフト", value: formatMetricValue(niconamaState.meta?.total?.gift) },
      { label: "広告", value: formatMetricValue(niconamaState.meta?.total?.ad) },
    );
  }

  if (stateResponse?.canSpeak !== undefined) {
    rows.push({ label: "話せる状態", value: stateResponse.canSpeak ? "はい" : "いいえ" });
  }

  if (stateResponse !== null && stateResponse !== undefined && "currentGame" in stateResponse) {
    rows.push({ label: "現在のゲーム", value: stateResponse.currentGame?.name ?? "-" });
  }

  if (stateResponse?.nGram !== undefined) {
    rows.push({ label: "生成N-gram", value: formatNGramValue(stateResponse.nGram) });
  }

  if (stateResponse?.speech !== undefined) {
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
      setAgentStateResponse(createMockAgentStateResponse());
      setIsShowingMockAgentState(true);
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
    <div className="mt-8 mx-auto w-full max-w-7xl text-left flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xl font-bold">配信エージェントの状態</h2>
        <button
          type="button"
          onClick={fetchAgentState}
          disabled={isLoadingAgentState}
          className="bg-emerald-300 text-emerald-950 border-0 px-5 py-1.5 rounded-lg font-bold transition-all duration-100 hover:bg-emerald-200 hover:-translate-y-px cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
        >
          更新
        </button>
      </div>
      <p className="text-sm text-emerald-200">
        最終更新: {lastUpdatedTime || "未取得"}（5秒ごとに自動更新）
      </p>
      {isShowingMockAgentState ? (
        <div
          data-testid="agent-status-mock-notice"
          className="w-full bg-emerald-950/70 border-2 border-emerald-300 rounded-xl p-3 text-emerald-50"
        >
          実配信状態が取得できないため、モック表示中
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
          className="w-full flex flex-col gap-4"
        >
          {liveDeliverySection ? <LiveDeliveryStatusSection liveDeliveryRows={liveDeliverySection.rows} /> : null}
          {markovModelSection ? <MarkovModelStatusSection markovModelRows={markovModelSection.rows} /> : null}
          {gameSection ? <GameStatusSection gameRows={gameSection.rows} /> : null}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";

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

type AgentStatusRow = {
  label: string
  value: string
  href?: string
};

export const AGENT_STATE_REFRESH_INTERVAL_MS = 5_000;
const AGENT_STATE_MOCK_QUERY_KEY = "agentStateMock";
const INVALID_AGENT_STATE_RESPONSE_ERROR = "配信状態の応答形式が不正です。";

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

const formatStartDate = (startAtUnixTimeSeconds: number | undefined): string => {
  if (typeof startAtUnixTimeSeconds !== "number" || !Number.isFinite(startAtUnixTimeSeconds) || startAtUnixTimeSeconds <= 0) {
    return "-";
  }
  const startAtUnixTimeMilliseconds = startAtUnixTimeSeconds >= 1_000_000_000_000
    ? startAtUnixTimeSeconds
    : startAtUnixTimeSeconds * 1000;
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

  const agentStatusRows = createAgentStatusRows(agentStateResponse);

  return (
    <div className="mt-8 mx-auto w-full max-w-5xl text-left flex flex-col gap-4">
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
      {agentStatusRows.length === 0 ? (
        <div
          data-testid="agent-status-empty"
          className="w-full min-h-[80px] bg-emerald-950/70 border-2 border-emerald-300 rounded-xl p-3 text-emerald-50"
        >
          {isLoadingAgentState ? "読み込み中..." : "配信情報はありません。"}
        </div>
      ) : (
        <dl
          data-testid="agent-status-details"
          className="w-full bg-emerald-950/70 border-2 border-emerald-300 rounded-xl p-3 text-emerald-50 grid grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-2"
        >
          {agentStatusRows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="font-bold whitespace-nowrap">{row.label}</dt>
              <dd className="break-all">
                {row.href ? (
                  <a className="underline" href={row.href} target="_blank" rel="noreferrer">
                    {row.value}
                  </a>
                ) : (
                  row.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

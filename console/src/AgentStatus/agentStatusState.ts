import type { AgentStateResponse } from "./types";

export const AGENT_STATE_REFRESH_INTERVAL_MS = 1_000;
export const AGENT_STATE_MOCK_NOTICE_MESSAGE = "配信エージェント状態モックを表示中";
const AGENT_STATE_MOCK_QUERY_KEY = "agentStateMock";
export const INVALID_AGENT_STATE_RESPONSE_ERROR = "配信状態の応答形式が不正です。";
const EVENT_SOURCE_CLOSED = typeof EventSource !== "undefined" ? EventSource.CLOSED : 2;

const AGENT_STATE_MOCK_NO_GAME_QUERY_KEY = "agentStateMockNoGame";

export const createMockAgentStateResponse = (): AgentStateResponse => {
  // Keep a minimal, deterministic dev mock here to avoid importing test-only fixtures
  // into production bundles. Tests should use `tests/fixtures/agentStateResponseMock`.
  const base: AgentStateResponse = {
    niconama: {
      type: "live",
      meta: {
        title: "配信エージェント状態モック (dev)",
        url: "https://example.com/watch/mock",
        start: 1_717_000_000,
        total: {
          listeners: 0,
          gift: 0,
          ad: 0,
        },
      },
    },
    commentCount: 0,
    canSpeak: false,
    currentGame: {
      name: "org.dashnet.orteil/cookieclicker",
      state: { status: "idle" },
    },
    nGram: 1,
    nGramRaw: 1,
    speech: { speech: "", silent: false },
    speechHistory: [],
  };

  const searchParams = typeof window === "undefined" ? "" : window.location.search;
  if (new URLSearchParams(searchParams).get(AGENT_STATE_MOCK_NO_GAME_QUERY_KEY) === "1") {
    return { ...base, currentGame: null };
  }
  return base;
};

export const isAgentStateMockQueryEnabled = (searchParams: string): boolean => {
  return new URLSearchParams(searchParams).get(AGENT_STATE_MOCK_QUERY_KEY) === "1";
};

export const shouldUseMockAgentState = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  return isAgentStateMockQueryEnabled(window.location.search);
};

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

export function shouldShowAgentStatusErrorForEventSourceError(readyState: number): boolean {
  return readyState === EVENT_SOURCE_CLOSED;
}

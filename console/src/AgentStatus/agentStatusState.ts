import type { AgentStateResponse } from "./types";

export const AGENT_STATE_REFRESH_INTERVAL_MS = 1_000;
export const AGENT_STATE_MOCK_NOTICE_MESSAGE = "配信エージェント状態モックを表示中";
export const AGENT_STATE_MOCK_RESPONSE_WINDOW_KEY = "__agentStateMockResponse";
const AGENT_STATE_MOCK_QUERY_KEY = "agentStateMock";
export const INVALID_AGENT_STATE_RESPONSE_ERROR = "配信状態の応答形式が不正です。";
const EVENT_SOURCE_CLOSED = typeof EventSource !== "undefined" ? EventSource.CLOSED : 2;

const AGENT_STATE_MOCK_NO_GAME_QUERY_KEY = "agentStateMockNoGame";

export const isAgentStateMockNoGameQueryEnabled = (searchParams: string): boolean => {
  return new URLSearchParams(searchParams).get(AGENT_STATE_MOCK_NO_GAME_QUERY_KEY) === "1";
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

export const readAgentStateMockResponseFromWindow = (sourceWindow: Window): AgentStateResponse => {
  const mockResponse = (sourceWindow as Window & Record<string, unknown>)[AGENT_STATE_MOCK_RESPONSE_WINDOW_KEY];
  if (mockResponse === undefined) {
    throw new Error("モックデータが設定されていません。");
  }
  return structuredClone(mockResponse as AgentStateResponse);
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

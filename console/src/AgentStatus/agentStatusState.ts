import { cloneAgentStateResponseMockFixture } from "../../../tests/fixtures/agentStateResponseMock";
import type { AgentStateResponse } from "./types";

export const AGENT_STATE_REFRESH_INTERVAL_MS = 1_000;
export const AGENT_STATE_MOCK_NOTICE_MESSAGE = "配信エージェント状態モックを表示中";
const AGENT_STATE_MOCK_QUERY_KEY = "agentStateMock";
export const INVALID_AGENT_STATE_RESPONSE_ERROR = "配信状態の応答形式が不正です。";
const EVENT_SOURCE_CLOSED = typeof EventSource !== "undefined" ? EventSource.CLOSED : 2;

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

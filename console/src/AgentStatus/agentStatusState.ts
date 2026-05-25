import type { AgentStateResponse } from "./types";

export const AGENT_STATE_REFRESH_INTERVAL_MS = 1_000;
export const INVALID_AGENT_STATE_RESPONSE_ERROR = "配信状態の応答形式が不正です。";
const EVENT_SOURCE_CLOSED = typeof EventSource !== "undefined" ? EventSource.CLOSED : 2;

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

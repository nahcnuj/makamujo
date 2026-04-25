import { useCallback, useEffect, useState } from "react";
import type { AgentStateResponse } from "../agentStateService";
import { fetchAgentStateFromApi } from "../agentStateService";

export function useAgentState() {
  const [agentStateResponse, setAgentStateResponse] = useState<AgentStateResponse | null>(null);
  const [agentStatusError, setAgentStatusError] = useState<string | null>(null);
  const [lastUpdatedTime, setLastUpdatedTime] = useState("");
  const [isLoadingAgentState, setIsLoadingAgentState] = useState(false);
  const [isShowingMockAgentState, setIsShowingMockAgentState] = useState(false);

  const fetchAgentState = useCallback(async () => {
    setIsLoadingAgentState(true);
    try {
      const responseData = await fetchAgentStateFromApi(fetch);
      setAgentStateResponse(responseData);
      setAgentStatusError(null);
      setIsShowingMockAgentState(false);
      setLastUpdatedTime(new Date().toLocaleTimeString("ja-JP"));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
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
  }, [fetchAgentState]);

  return {
    agentStateResponse,
    setAgentStateResponse,
    agentStatusError,
    setAgentStatusError,
    lastUpdatedTime,
    setLastUpdatedTime,
    isLoadingAgentState,
    isShowingMockAgentState,
    setIsShowingMockAgentState,
    fetchAgentState,
  } as const;
}

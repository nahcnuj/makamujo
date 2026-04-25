import { useCallback, useState } from "react";
import type { AgentStateResponse } from "../agentStateService";

type HookState = {
  agentStateResponse: AgentStateResponse | null;
  agentStatusError: string | null;
  lastUpdatedTime: string;
  isLoadingAgentState: boolean;
  isShowingMockAgentState: boolean;
};

export function useAgentState() {
  const [state, setInternalState] = useState<HookState>({
    agentStateResponse: null,
    agentStatusError: null,
    lastUpdatedTime: "",
    isLoadingAgentState: false,
    isShowingMockAgentState: false,
  });

  const setState = useCallback(
    (patch: Partial<HookState> | ((prev: HookState) => Partial<HookState>)) => {
      setInternalState((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));
    },
    [],
  );

  return { state, setState } as const;
}

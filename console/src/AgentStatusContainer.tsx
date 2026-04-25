import { useEffect } from "react";
import { AgentStatusView, startAgentStateAutoRefresh } from "./AgentStatus";
import { useAgentState } from "./hooks/useAgentState";
import { useAgentStateWebSocket } from "./hooks/useAgentStateWebSocket";

export function AgentStatus() {
    const {
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
    } = useAgentState();

    const { isWebSocketConnected } = useAgentStateWebSocket({
        onMessage: (response) => {
            setAgentStateResponse(response);
            setAgentStatusError(null);
            setIsShowingMockAgentState(false);
            setLastUpdatedTime(new Date().toLocaleTimeString("ja-JP"));
        },
        onError: (errorMessage) => {
            setAgentStatusError(errorMessage);
            setAgentStateResponse(null);
            setIsShowingMockAgentState(false);
            setLastUpdatedTime(new Date().toLocaleTimeString("ja-JP"));
        },
    });

    useEffect(() => {
        if (isWebSocketConnected) {
            return;
        }
        return startAgentStateAutoRefresh(fetchAgentState);
    }, [fetchAgentState, isWebSocketConnected]);

    return (
        <AgentStatusView
            agentStateResponse={agentStateResponse}
            agentStatusError={agentStatusError}
            lastUpdatedTime={lastUpdatedTime}
            isLoadingAgentState={isLoadingAgentState}
            isShowingMockAgentState={isShowingMockAgentState}
            fetchAgentState={fetchAgentState}
        />
    );
}

import { useCallback, useEffect } from "react";
import { AgentStatusView, startAgentStateAutoRefresh } from "./AgentStatus";
import { useAgentState } from "./hooks/useAgentState";
import { useAgentStateWebSocket } from "./hooks/useAgentStateWebSocket";
import { fetchAgentStateFromApi } from "./agentStateService";

export function AgentStatus() {
    const { state, setState } = useAgentState();
    const {
        agentStateResponse,
        agentStatusError,
        lastUpdatedTime,
        isLoadingAgentState,
        isShowingMockAgentState,
    } = state;

    const fetchAgentState = useCallback(async () => {
        setState({ isLoadingAgentState: true });
        try {
            const responseData = await fetchAgentStateFromApi(fetch);
            setState((prev) => ({
                ...prev,
                agentStateResponse: responseData,
                agentStatusError: null,
                isShowingMockAgentState: false,
                lastUpdatedTime: new Date().toLocaleTimeString("ja-JP"),
            }));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            setState((prev) => ({
                ...prev,
                agentStatusError: errorMessage,
                agentStateResponse: null,
                isShowingMockAgentState: false,
                lastUpdatedTime: new Date().toLocaleTimeString("ja-JP"),
            }));
        } finally {
            setState({ isLoadingAgentState: false });
        }
    }, [setState]);

    const { isWebSocketConnected } = useAgentStateWebSocket({
        onMessage: (response) => {
            setState((prev) => ({
                ...prev,
                agentStateResponse: response,
                agentStatusError: null,
                isShowingMockAgentState: false,
                lastUpdatedTime: new Date().toLocaleTimeString("ja-JP"),
            }));
        },
        onError: (errorMessage) => {
            setState((prev) => ({
                ...prev,
                agentStatusError: errorMessage,
                agentStateResponse: null,
                isShowingMockAgentState: false,
                lastUpdatedTime: new Date().toLocaleTimeString("ja-JP"),
            }));
        },
    });

    useEffect(() => {
        // initial fetch
        void fetchAgentState();
    }, [fetchAgentState]);

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

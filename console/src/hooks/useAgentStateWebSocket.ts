import { useCallback, useEffect, useRef, useState } from "react";
import { createAgentStateWebSocketUrl, AGENT_STATE_WEB_SOCKET_RECONNECT_DELAY_MS, parseAgentStateResponse } from "../agentStateService";
import type { AgentStateResponse } from "../agentStateService";

type UseAgentStateWebSocketParams = {
  onMessage: (response: AgentStateResponse) => void;
  onError?: (errorMessage: string) => void;
  enabled?: boolean;
};

export function useAgentStateWebSocket({ onMessage, onError, enabled = true }: UseAgentStateWebSocketParams) {
  const websocketRef = useRef<WebSocket | null>(null);
  const websocketReconnectTimeoutIdRef = useRef<number | undefined>(undefined);
  const websocketActiveRef = useRef(true);
  const [isWebSocketConnected, setIsWebSocketConnected] = useState(false);

  const cleanup = useCallback(() => {
    websocketActiveRef.current = false;
    if (websocketReconnectTimeoutIdRef.current !== undefined) {
      window.clearTimeout(websocketReconnectTimeoutIdRef.current);
      websocketReconnectTimeoutIdRef.current = undefined;
    }
    if (websocketRef.current !== null) {
      websocketRef.current.close();
      websocketRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (typeof window === "undefined" || !websocketActiveRef.current || websocketRef.current !== null) {
      return;
    }

    const socket = new WebSocket(createAgentStateWebSocketUrl(`wss://${window.location.host}`));
    websocketRef.current = socket;

    const scheduleReconnect = () => {
      if (!websocketActiveRef.current) {
        return;
      }
      if (websocketReconnectTimeoutIdRef.current !== undefined) {
        window.clearTimeout(websocketReconnectTimeoutIdRef.current);
      }
      websocketReconnectTimeoutIdRef.current = window.setTimeout(() => {
        websocketReconnectTimeoutIdRef.current = undefined;
        connect();
      }, AGENT_STATE_WEB_SOCKET_RECONNECT_DELAY_MS);
    };

    socket.addEventListener("open", () => {
      setIsWebSocketConnected(true);
      if (onError) {
        onError("");
      }
    });

    socket.addEventListener("message", (event) => {
      const payload = typeof event.data === "string" ? event.data : String(event.data);
      try {
        const responseData = parseAgentStateResponse(payload);
        onMessage(responseData);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (onError) onError(errorMessage);
      }
    });

    const handleSocketClosed = () => {
      setIsWebSocketConnected(false);
      websocketRef.current = null;
      scheduleReconnect();
    };

    socket.addEventListener("close", handleSocketClosed);
    socket.addEventListener("error", handleSocketClosed);
  }, [onMessage, onError]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    connect();
    return cleanup;
  }, [connect, cleanup, enabled]);

  return { isWebSocketConnected, connect, cleanup } as const;
}

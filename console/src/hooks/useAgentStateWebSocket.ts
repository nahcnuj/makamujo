import { useCallback, useEffect, useRef, useState } from "react";

export const AGENT_STATE_WEB_SOCKET_PATH = "/console/api/ws";
export const AGENT_STATE_WEB_SOCKET_RECONNECT_DELAY_MS = 2_000;

export const createAgentStateWebSocketUrl = (baseHref: string): string => {
  return new URL(AGENT_STATE_WEB_SOCKET_PATH, baseHref).toString();
};

export type AgentStateResponse = {
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
        comments?: number
      }
    }
  }
  canSpeak?: boolean
  currentGame?: {
    name?: string
    state?: Record<string, unknown>
  } | null
  nGram?: number
  nGramRaw?: number
  speech?: {
    speech?: string
    silent?: boolean
  }
  speechHistory?: Array<{
    id?: string
    speech?: string
    nGram?: number
    nGramRaw?: number
  }>
};
const INVALID_AGENT_STATE_RESPONSE_ERROR = "配信状態の応答形式が不正です。";

export const parseAgentStateResponse = (responseText: string): AgentStateResponse => {
  try {
    return JSON.parse(responseText) as AgentStateResponse;
  } catch {
    throw new SyntaxError(INVALID_AGENT_STATE_RESPONSE_ERROR);
  }
};

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

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
export type CreateWebSocketConnectorParams = {
  getUrl: () => string;
  makeWebSocket?: (url: string) => { addEventListener: (type: string, handler: (ev?: any) => void) => void; close?: () => void };
  reconnectDelayMs?: number;
  setTimeoutImpl?: (cb: () => void, ms: number) => number;
  clearTimeoutImpl?: (id: number) => void;
  onMessage: (response: AgentStateResponse) => void;
  onError?: (errorMessage: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

export function createWebSocketConnector({
  getUrl,
  makeWebSocket = (url: string) => new WebSocket(url),
  reconnectDelayMs = AGENT_STATE_WEB_SOCKET_RECONNECT_DELAY_MS,
  setTimeoutImpl = (cb: () => void, ms: number) => window.setTimeout(cb, ms),
  clearTimeoutImpl = (id: number) => window.clearTimeout(id),
  onMessage,
  onError,
  onOpen,
  onClose,
}: CreateWebSocketConnectorParams) {
  let socketRef: any = null;
  let reconnectId: number | undefined = undefined;
  let active = true;

  const scheduleReconnect = () => {
    if (!active) return;
    if (reconnectId !== undefined) clearTimeoutImpl(reconnectId);
    reconnectId = setTimeoutImpl(() => {
      reconnectId = undefined;
      connect();
    }, reconnectDelayMs);
  };

  function cleanup() {
    active = false;
    if (reconnectId !== undefined) {
      clearTimeoutImpl(reconnectId);
      reconnectId = undefined;
    }
    if (socketRef !== null && typeof socketRef.close === "function") {
      try {
        socketRef.close();
      } catch {
        // ignore
      }
      socketRef = null;
    }
  }

  function connect() {
    if (typeof window === "undefined" || !active || socketRef !== null) return;
    const url = getUrl();
    const socket = makeWebSocket(url);
    socketRef = socket;

    socket.addEventListener("open", () => {
      if (onOpen) onOpen();
      if (onError) onError("");
    });

    socket.addEventListener("message", (event: any) => {
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
      if (onClose) onClose();
      socketRef = null;
      scheduleReconnect();
    };

    socket.addEventListener("close", handleSocketClosed);
    socket.addEventListener("error", handleSocketClosed);
  }

  return { connect, cleanup } as const;
}

export function useAgentStateWebSocket({ onMessage, onError, enabled = true }: UseAgentStateWebSocketParams) {
  const [isWebSocketConnected, setIsWebSocketConnected] = useState(false);
  const connectorRef = useRef<ReturnType<typeof createWebSocketConnector> | null>(null);

  const connect = useCallback(() => {
    if (typeof window === "undefined") return;
    if (connectorRef.current !== null) {
      // already created and possibly connected
      connectorRef.current.connect();
      return;
    }
    const connector = createWebSocketConnector({
      getUrl: () => createAgentStateWebSocketUrl(`wss://${window.location.host}`),
      makeWebSocket: (url: string) => new WebSocket(url),
      onMessage: (resp) => {
        setIsWebSocketConnected(true);
        onMessage(resp);
      },
      onError: (err) => {
        setIsWebSocketConnected(false);
        if (onError) onError(err);
      },
      onOpen: () => setIsWebSocketConnected(true),
      onClose: () => setIsWebSocketConnected(false),
    });
    connectorRef.current = connector;
    connector.connect();
  }, [onMessage, onError]);

  const cleanup = useCallback(() => {
    if (connectorRef.current) {
      connectorRef.current.cleanup();
      connectorRef.current = null;
    }
    setIsWebSocketConnected(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    connect();
    return cleanup;
  }, [connect, cleanup, enabled]);

  return { isWebSocketConnected, connect, cleanup } as const;
}

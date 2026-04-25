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

export type HookState = {
  agentStateResponse: AgentStateResponse | null;
  agentStatusError: string | null;
  lastUpdatedTime: string;
  isLoadingAgentState: boolean;
  isShowingMockAgentState: boolean;
  isWebSocketConnected: boolean;
};

const INITIAL_STATE: HookState = {
  agentStateResponse: null,
  agentStatusError: null,
  lastUpdatedTime: "",
  isLoadingAgentState: false,
  isShowingMockAgentState: false,
  isWebSocketConnected: false,
};

export function createAgentStateStore(options?: {
  getUrl?: () => string;
  makeWebSocket?: (url: string) => any;
  reconnectDelayMs?: number;
  setTimeoutImpl?: (cb: () => void, ms: number) => number;
  clearTimeoutImpl?: (id: number) => void;
}) {
  let state: HookState = { ...INITIAL_STATE };
  const listeners: Array<(s: HookState) => void> = [];

  const notify = () => listeners.forEach((l) => l(state));

  const setState = (patch: Partial<HookState> | ((prev: HookState) => Partial<HookState>)) => {
    const next = typeof patch === "function" ? { ...state, ...(patch as any)(state) } : { ...state, ...patch };
    state = next;
    notify();
  };

  const connector = createWebSocketConnector({
    getUrl: options?.getUrl ?? (() => createAgentStateWebSocketUrl(`wss://${(globalThis as any).location?.host ?? "localhost"}`)),
    makeWebSocket: options?.makeWebSocket,
    reconnectDelayMs: options?.reconnectDelayMs,
    setTimeoutImpl: options?.setTimeoutImpl,
    clearTimeoutImpl: options?.clearTimeoutImpl,
    onMessage: (response) => {
      setState({
        agentStateResponse: response,
        agentStatusError: null,
        isShowingMockAgentState: false,
        lastUpdatedTime: new Date().toLocaleTimeString("ja-JP"),
        isLoadingAgentState: false,
      });
    },
    onError: (errorMessage) => {
      setState({
        agentStatusError: errorMessage,
        agentStateResponse: null,
        isShowingMockAgentState: false,
        lastUpdatedTime: new Date().toLocaleTimeString("ja-JP"),
        isLoadingAgentState: false,
      });
    },
    onOpen: () => {
      setState({ isWebSocketConnected: true, isLoadingAgentState: false });
    },
    onClose: () => {
      setState({ isWebSocketConnected: false });
    },
  });

  const connect = () => {
    setState({ isLoadingAgentState: true });
    connector.connect();
  };

  const cleanup = () => connector.cleanup();

  const subscribe = (listener: (s: HookState) => void) => {
    listeners.push(listener);
    // notify immediately with current state
    listener(state);
    return () => {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  };

  return { connect, cleanup, subscribe, setState, getState: () => state } as const;
}

export function useAgentState() {
  const storeRef = useRef<ReturnType<typeof createAgentStateStore> | null>(null);
  const [state, setInternalState] = useState<HookState>(INITIAL_STATE);

  useEffect(() => {
    // lazily create store with browser defaults
    storeRef.current = createAgentStateStore();
    const unsub = storeRef.current.subscribe(setInternalState);
    storeRef.current.connect();
    return () => {
      unsub();
      storeRef.current?.cleanup();
      storeRef.current = null;
    };
  }, []);

  const setState = useCallback(
    (patch: Partial<HookState> | ((prev: HookState) => Partial<HookState>)) => {
      if (!storeRef.current) return;
      storeRef.current.setState(patch as any);
    },
    [],
  );

  const refresh = useCallback(() => {
    if (!storeRef.current) return;
    storeRef.current.cleanup();
    storeRef.current.connect();
    storeRef.current.setState({ isLoadingAgentState: true });
  }, []);

  return { state, setState, refresh } as const;
}

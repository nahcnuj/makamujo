import { useCallback, useEffect, useRef, useState } from "react";
import { createWebSocketConnector, createAgentStateWebSocketUrl } from "./useAgentStateWebSocket";
import type { AgentStateResponse } from "./useAgentStateWebSocket";

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

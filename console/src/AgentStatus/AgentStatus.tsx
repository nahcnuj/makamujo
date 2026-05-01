import { Container } from "automated-gameplay-transmitter";
import { useCallback, useEffect, useState } from "react";
import type { AgentStatusSection, AgentStateResponse } from "./types";
import {
  AGENT_STATE_MOCK_NOTICE_MESSAGE,
  INVALID_AGENT_STATE_RESPONSE_ERROR,
  createMockAgentStateResponse,
  isAgentStateMockQueryEnabled,
  shouldUseMockAgentState,
  parseAgentStateResponse,
  startAgentStateAutoRefresh,
} from "./agentStatusState";
import { createAgentStatusSections } from "./createAgentStatusSections";
import { GAME_SECTION_TITLE } from "./GameStatusSection";
import { GameStatusSection } from "./GameStatusSection";
import { LIVE_DELIVERY_SECTION_TITLE } from "./LiveDeliveryStatusSection";
import { LiveDeliveryStatusSection } from "./LiveDeliveryStatusSection";
import { MARKOV_MODEL_SECTION_TITLE } from "./MarkovModelStatusSection";
import { MarkovModelStatusSection } from "./MarkovModelStatusSection";

const AGENT_STATUS_GRID_ROW_TEMPLATE_CLASS = "grid-rows-[auto_minmax(0,1fr)]";

export const AgentStatus = () => {
  const [agentStateResponse, setAgentStateResponse] = useState<AgentStateResponse | null>(null);
  const [agentStatusError, setAgentStatusError] = useState<string | null>(null);
  const [lastUpdatedTime, setLastUpdatedTime] = useState("");
  const [isLoadingAgentState, setIsLoadingAgentState] = useState(false);
  const [isShowingMockAgentState, setIsShowingMockAgentState] = useState(false);

  const fetchAgentState = useCallback(async () => {
    setIsLoadingAgentState(true);
    try {
      if (shouldUseMockAgentState()) {
        setAgentStateResponse(createMockAgentStateResponse());
        setAgentStatusError(null);
        setIsShowingMockAgentState(true);
        setLastUpdatedTime(new Date().toLocaleTimeString("ja-JP"));
        return;
      }

      throw new Error("ライブ更新はSSEでのみ提供されます。");
    } catch (error) {
      const errorMessage =
        error instanceof SyntaxError
          ? INVALID_AGENT_STATE_RESPONSE_ERROR
          : error instanceof Error
            ? error.message
            : String(error);
      setAgentStatusError(errorMessage);
      setAgentStateResponse(null);
      setIsShowingMockAgentState(false);
      setLastUpdatedTime(new Date().toLocaleTimeString("ja-JP"));
    } finally {
      setIsLoadingAgentState(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (shouldUseMockAgentState()) {
      void fetchAgentState();
      return startAgentStateAutoRefresh(fetchAgentState);
    }

    setIsLoadingAgentState(false);
    setAgentStatusError(null);

    let es: EventSource | null = null;
    (async () => {
      const sseUrl = "/console/api/ws";
      try { (window as any).__sseUrl = sseUrl; } catch {}
      try { console.log("[TRACE] AgentStatus connecting EventSource ->", sseUrl); } catch {}
      try {
        es = new EventSource(sseUrl);
      } catch {
        setAgentStatusError("ライブ接続に失敗しました");
        return;
      }

      es.onopen = () => {
        setAgentStatusError(null);
      };
      es.onmessage = (ev: MessageEvent) => {
        try {
          const responseData = parseAgentStateResponse(String(ev.data));
          setAgentStateResponse(responseData);
          setAgentStatusError(null);
          setIsShowingMockAgentState(false);
          setLastUpdatedTime(new Date().toLocaleTimeString("ja-JP"));
        } catch {
          setAgentStatusError(INVALID_AGENT_STATE_RESPONSE_ERROR);
        }
      };
      es.onerror = () => {
        try {
          if (es?.readyState === EventSource.CLOSED) {
            setAgentStatusError("ライブ接続が切断されました");
          }
        } catch {
          setAgentStatusError("ライブ接続が切断されました");
        }
      };
    })();

    return () => {
      try { es?.close(); } catch {}
    };
  }, [fetchAgentState]);

  const agentStatusSections = createAgentStatusSections(agentStateResponse);
  const sectionMap = agentStatusSections.reduce<Partial<Record<AgentStatusSection["title"], AgentStatusSection>>>(
    (accumulatedSections, section) => {
      accumulatedSections[section.title] = section;
      return accumulatedSections;
    },
    {},
  );
  const liveDeliverySection = sectionMap[LIVE_DELIVERY_SECTION_TITLE];
  const markovModelSection = sectionMap[MARKOV_MODEL_SECTION_TITLE];
  const gameSection = sectionMap[GAME_SECTION_TITLE];
  const hasPrimaryColumnSections = liveDeliverySection !== undefined || gameSection !== undefined;

  return (
    <div className={`mx-auto w-full max-w-7xl h-full min-h-0 text-left grid ${AGENT_STATUS_GRID_ROW_TEMPLATE_CLASS} gap-4`}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">
            <a href="https://live.nicovideo.jp/watch/user/14171889" target="_blank" rel="noopener noreferrer">
              馬可無序
            </a>
          </h1>
          <p className="text-sm text-emerald-200 whitespace-nowrap">
            最終更新: {lastUpdatedTime || "未取得"}
          </p>
          <button
            type="button"
            onClick={fetchAgentState}
            disabled={isLoadingAgentState}
            className="bg-emerald-300 text-emerald-950 border-0 px-5 py-1.5 rounded-lg font-bold transition-all duration-100 hover:bg-emerald-200 hover:-translate-y-px cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
          >
            更新
          </button>
        </div>
        {isShowingMockAgentState ? (
          <Container>
            <div
              data-testid="agent-status-mock-notice"
              className="w-full bg-emerald-950/70 border-2 border-emerald-300 rounded-xl p-3 text-emerald-50"
            >
              {AGENT_STATE_MOCK_NOTICE_MESSAGE}
            </div>
          </Container>
        ) : null}
        {agentStatusError ? (
          <div
            data-testid="agent-status-error"
            className="w-full min-h-[80px] bg-red-950/60 border-2 border-red-300 rounded-xl p-3 text-red-100"
          >
            取得エラー: {agentStatusError}
          </div>
        ) : null}
      </div>
      {agentStatusSections.length === 0 ? (
        <Container>
          <div
            data-testid="agent-status-empty"
            className="w-full min-h-[80px] bg-emerald-950/70 border-2 border-emerald-300 rounded-xl p-3 text-emerald-50"
          >
            {isLoadingAgentState ? "読み込み中..." : "配信情報はありません。"}
          </div>
        </Container>
      ) : (
        <div
          data-testid="agent-status-details"
          className="w-full h-full min-h-0 overflow-y-auto pr-1 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] auto-rows-min xl:auto-rows-[minmax(0,1fr)] gap-4"
        >
          {hasPrimaryColumnSections ? (
            <div className="min-w-0 min-h-0 h-full flex flex-col gap-4">
              {liveDeliverySection ? <LiveDeliveryStatusSection liveDeliveryRows={liveDeliverySection.rows} /> : null}
              {gameSection ? <GameStatusSection gameRows={gameSection.rows} /> : null}
            </div>
          ) : null}
          {markovModelSection ? (
            <div className={`min-w-0 min-h-0 h-full${hasPrimaryColumnSections ? " xl:col-start-2" : ""}`}>
              <MarkovModelStatusSection markovModelRows={markovModelSection.rows} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

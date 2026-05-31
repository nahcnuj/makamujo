import { Container } from "../agt-compat";
import { useLayoutEffect, useState, useRef } from "hono/jsx";
import type { AgentStatusSection, AgentStateResponse } from "./types";
import {
  INVALID_AGENT_STATE_RESPONSE_ERROR,
  parseAgentStateResponse,
} from "./agentStatusState";
import { createAgentStatusSections } from "./createAgentStatusSections";
import { GameStatusSection } from "./GameStatusSection";
import { LIVE_DELIVERY_SECTION_TITLE } from "./LiveDeliveryStatusSection";
import { LiveDeliveryStatusSection } from "./LiveDeliveryStatusSection";
import { MARKOV_MODEL_SECTION_TITLE } from "./MarkovModelStatusSection";
import { MarkovModelStatusSection } from "./MarkovModelStatusSection";
import { AgentStatusHeader } from "./AgentStatusHeader";
import { formatStreamStartTime } from "./agentStatusUtils";

const AGENT_STATUS_GRID_ROW_TEMPLATE_CLASS = "grid-rows-[auto_minmax(0,1fr)]";

export const AgentStatus = () => {
  const [agentStateResponse, setAgentStateResponse] = useState<AgentStateResponse | null>(null);
  const [agentStatusError, setAgentStatusError] = useState<string | null>(null);
  const [lastUpdatedTime, setLastUpdatedTime] = useState("");
  const [isLoadingAgentState, setIsLoadingAgentState] = useState(false);
  const prevTypeRef = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;

    setIsLoadingAgentState(false);
    setAgentStatusError(null);

    let es: EventSource | null = null;
    (async () => {
      const sseUrl = "/console/api/ws";
      try { (window as any).__sseUrl = sseUrl; } catch {}
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

          // Detect end-of-program and reload the page when appropriate.
          try {
            const currentType = responseData?.niconama?.type;
            const currentUrl = responseData?.niconama?.meta?.url as string | undefined;
            const currentTitle = responseData?.niconama?.meta?.title as string | undefined;

            const prevType = prevTypeRef.current;

            if (currentType === 'offline' && prevType === 'live') {
              try {
                window.location.reload();
                return;
              } catch {}
            }

            if (currentTitle && currentTitle.includes('公開終了') && currentUrl) {
              try {
                const endedKey = `program-ended-${currentUrl}`;
                if (!sessionStorage.getItem(endedKey)) {
                  sessionStorage.setItem(endedKey, '1');
                  window.location.reload();
                  return;
                }
              } catch {}
            }

            prevTypeRef.current = currentType;
          } catch (e) {
            // ignore detection errors
          }

          setAgentStateResponse(responseData);
          setAgentStatusError(null);
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
  }, []);

  const streamTitle = agentStateResponse?.niconama?.meta?.title;
  const streamUrl = agentStateResponse?.niconama?.meta?.url;
  const streamStartTime = agentStateResponse?.niconama?.meta?.start
    ? formatStreamStartTime(agentStateResponse.niconama.meta.start)
    : undefined;

  const [isRecentCommentsOpen, setIsRecentCommentsOpen] = useState(false);
  const toggleRecentComments = () => {
    setIsRecentCommentsOpen((current) => !current);
  };

  const agentStatusSections = createAgentStatusSections(agentStateResponse, {
    showRecentComments: isRecentCommentsOpen,
    toggleRecentComments,
  });
  const sectionMap = agentStatusSections.reduce<Partial<Record<AgentStatusSection["title"], AgentStatusSection>>>(
    (accumulatedSections, section) => {
      accumulatedSections[section.title] = section;
      return accumulatedSections;
    },
    {},
  );
  const liveDeliverySection = sectionMap[LIVE_DELIVERY_SECTION_TITLE];
  const markovModelSection = sectionMap[MARKOV_MODEL_SECTION_TITLE];
  const gameSection = agentStatusSections.find((section) => section.title.includes("プレイ中"));
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
          <AgentStatusHeader
            streamTitle={streamTitle ?? undefined}
            streamUrl={streamUrl ?? undefined}
            startTime={streamStartTime}
          />
          <p
            data-testid={agentStatusError ? "agent-status-error" : "agent-status-last-updated"}
            className={agentStatusError ? "text-sm text-red-200 whitespace-nowrap" : "text-sm text-emerald-200 whitespace-nowrap"}
          >
            {agentStatusError ? `取得エラー: ${agentStatusError}` : `最終更新: ${lastUpdatedTime || "未取得"}`}
          </p>
        </div>
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
          className="w-full h-full min-h-0 pr-1 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 overflow-y-auto"
        >
          {hasPrimaryColumnSections ? (
            <div className="min-w-0 min-h-0 h-full flex flex-col gap-4 overflow-hidden">
              {liveDeliverySection ? <LiveDeliveryStatusSection liveDeliveryRows={liveDeliverySection.rows} /> : null}
              {gameSection ? (
                <div className="min-h-0 flex-1 overflow-hidden">
                  <GameStatusSection title={gameSection.title} gameRows={gameSection.rows} className="h-full" />
                </div>
              ) : null}
            </div>
          ) : null}
          {markovModelSection ? (
            <div className={`min-w-0 min-h-0 h-full overflow-y-auto${hasPrimaryColumnSections ? " xl:col-start-2" : ""}`}>
              <MarkovModelStatusSection markovModelRows={markovModelSection.rows} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

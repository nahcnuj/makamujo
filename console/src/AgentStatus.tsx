import { useCallback, useEffect, useState } from "react";

export function AgentStatus() {
  const [agentStateJson, setAgentStateJson] = useState("読み込み中...");
  const [isLoadingAgentState, setIsLoadingAgentState] = useState(false);

  const fetchAgentState = useCallback(async () => {
    setIsLoadingAgentState(true);
    try {
      const response = await fetch("/console/api/agent-state");
      const data = await response.json();
      setAgentStateJson(JSON.stringify(data, null, 2));
    } catch (error) {
      setAgentStateJson(String(error));
    } finally {
      setIsLoadingAgentState(false);
    }
  }, []);

  useEffect(() => {
    void fetchAgentState();
  }, [fetchAgentState]);

  return (
    <div className="mt-8 mx-auto w-full max-w-2xl text-left flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xl font-bold">配信エージェントの状態</h2>
        <button
          type="button"
          onClick={() => {
            void fetchAgentState();
          }}
          disabled={isLoadingAgentState}
          className="bg-[#fbf0df] text-[#1a1a1a] border-0 px-5 py-1.5 rounded-lg font-bold transition-all duration-100 hover:bg-[#f3d5a3] hover:-translate-y-px cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
        >
          更新
        </button>
      </div>
      <pre
        data-testid="agent-status-json"
        className="w-full min-h-[140px] bg-[#1a1a1a] border-2 border-[#fbf0df] rounded-xl p-3 text-[#fbf0df] font-mono overflow-x-auto"
      >
        {agentStateJson}
      </pre>
    </div>
  );
}

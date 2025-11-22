import { useAgentContext } from "../contexts/AgentContext";

export function GamePanel() {
  const { gameState } = useAgentContext();

  return (
    <div className="h-full flex flex-col justify-between text-2xl/8">
      <div className="flex-none">
        <pre className="text-xs text-wrap break-all">
          {JSON.stringify(gameState, null, 1)}
        </pre>
      </div>
      <div className="flex-none">
        <pre className="text-xs text-wrap break-all">
          {JSON.stringify(gameState, null, 1)}
        </pre>
      </div>
    </div>
  );
}

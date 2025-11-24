'use client';

import { useAgentContext } from "../../../../../src/contexts/AgentContext";
import type { State } from "./State";

export default function () {
  const { gameState } = useAgentContext() as { gameState: State };
  console.log('CookieClickerComponent', gameState);
  return (
    <>
      <div>
        {`🍪${gameState.cookies}`}
      </div>
    </>
  );
}

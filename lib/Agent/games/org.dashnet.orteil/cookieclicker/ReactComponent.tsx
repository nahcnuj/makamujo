'use client';

import { useAgentContext } from "../../../../../src/contexts/AgentContext";

export default function () {
  const { playing } = useAgentContext();
  console.log('CookieClickerComponent', playing);
  return (playing && (
    <>
      <div>
        {`🍪${playing.state.cookies}`}
      </div>
    </>
  ));
}

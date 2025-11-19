'use client';

import { createContext, useContext, useState, type PropsWithChildren } from "react";
import { useInterval } from "../hooks/useInterval";

type Data = {
  speech: string
  gameState?: unknown
};

const AgentContext = createContext<Data>({
  speech: '',
});

export const useAgentContext = () => useContext(AgentContext);

export const AgentProvider = ({ children }: PropsWithChildren) => {
  const [speech, setSpeech] = useState('');
  const [gameState, setGameState] = useState<Data['gameState']>();

  useInterval(33, async () => {
    const { text } = await fetch('/api/speech')
      .then(res => res.ok ? res.json() : { text: 'not ok' })
      .catch(res => ({ text: JSON.stringify(res, null, 0) }));
    setSpeech(text);
  });

  useInterval(33, async () => {
    const state = await fetch('/api/game')
      .then(res => res.ok ? res.json() : { error: 'not ok' })
      .catch(res => ({ error: JSON.stringify(res, null, 0) }));
    setGameState(state);
  });

  return (
    <AgentContext.Provider value={{ speech, gameState }}>
      {children}
    </AgentContext.Provider>
  );
};
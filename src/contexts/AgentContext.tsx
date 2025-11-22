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

  useInterval(100, async () => {
    const { speech } = await fetch('/api/speech', { unix: './var/api-speech.sock' })
      .then(res => res.ok ? res.json() : { speech: '' })
      .catch(err => {
        console.warn('[WARN]', err);
        return { speech: '' };
      });
    if (speech) {
      setSpeech(speech);
    }
  });

  useInterval(33, async () => {
    const state = await fetch('/api/game', { unix: './var/api-game.sock' })
      .then(res => res.ok ? res.json() : { error: 'not ok' })
      .catch(error => ({ error }));
    setGameState(state);
  });

  return (
    <AgentContext.Provider value={{ speech, gameState }}>
      {children}
    </AgentContext.Provider>
  );
};

'use client';

import { createContext, useContext, useState, type PropsWithChildren } from "react";
import type { StreamState } from "../../lib/Agent/states";
import { useInterval } from "../hooks/useInterval";

type Data = {
  speech: string
  gameState?: unknown
  streamState?: StreamState
};

const AgentContext = createContext<Data>({
  speech: '',
});

export const useAgentContext = () => useContext(AgentContext);

export const AgentProvider = ({ children }: PropsWithChildren) => {
  const [speech, setSpeech] = useState('');
  const [gameState, setGameState] = useState<Data['gameState']>();
  const [streamState, setStreamState] = useState<StreamState>();

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
    const { state } = await fetch('/api/game', { unix: './var/api-game.sock' })
      .then(res => res.ok ? res.json() : { error: 'not ok' })
      .catch(error => ({ error }));
    setGameState(state);
  });

  useInterval(33, async () => {
    const { niconama } = await fetch('/api/meta', { unix: './var/api-meta.sock' })
      .then(res => res.ok ? res.json() : { error: 'not ok' })
      .catch(error => ({ error }));
    console.log(niconama);
    setStreamState(niconama);
  });

  return (
    <AgentContext.Provider value={{ speech, gameState, streamState }}>
      {children}
    </AgentContext.Provider>
  );
};

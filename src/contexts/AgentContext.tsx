'use client';

import { createContext, useContext, useState, type PropsWithChildren } from "react";
import type { Games } from "../../lib/Agent/games";
import type { AgentState } from "../../lib/Agent/State";
import { useInterval } from "automated-gameplay-transmitter";
import { updateSpeechState } from "./speechState";

type Data = {
  speech: string
  silent: boolean
  playing?: {
    name: keyof typeof Games
    state: any
  }
  streamState?: AgentState
};

const AgentContext = createContext<Data>({
  speech: '',
  silent: false,
});

export const useAgentContext = () => useContext(AgentContext);

export const AgentProvider = ({ children }: PropsWithChildren) => {
  const [speech, setSpeech] = useState('');
  const [silent, setSilent] = useState(false);
  const [playing, setPlaying] = useState<Data['playing']>();
  const [streamState, setStreamState] = useState<AgentState>();

  useInterval(100, async () => {
    const res = await fetch('/api/speech', { unix: './var/api-speech.sock' })
      .then(res => res.ok ? res.json() : null)
      .catch(err => {
        console.warn('[WARN]', err);
        return null;
      });
    if (res !== null) {
      updateSpeechState(res, speech, setSpeech, setSilent);
    }
  });

  useInterval(100, async () => {
    const res = await fetch('/api/game', { unix: './var/api-game.sock' })
      .then(res => res.ok ? res.json() : { error: 'not ok' })
      .catch(error => ({ error }));
    if (res?.name) {
      setPlaying(res);
    }
  });

  useInterval(100, async () => {
    const res = await fetch('/api/meta', { unix: './var/api-meta.sock' })
      .then(res => res.ok ? res.json() : null)
      .catch(error => {
        console.warn('[WARN]', error);
        return null;
      });
    if (res !== null) {
      const { niconama } = res;
      // console.log(JSON.stringify(niconama, null, 2));
      setStreamState(niconama);
    }
  });

  return (
    <AgentContext.Provider value={{ speech, silent, streamState, playing }}>
      {children}
    </AgentContext.Provider>
  );
};

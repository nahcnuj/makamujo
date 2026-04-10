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

/**
 * Applies a speech API response to state.
 * When `res` is `null` (fetch failed), no state update is performed so that
 * the last displayed speech text is preserved across transient API errors.
 */
export const applySpeechApiResponse = (
  res: { speech?: string; silent?: boolean } | null,
  currentSpeech: string,
  setSpeech: (speech: string) => void,
  setSilent: (silent: boolean) => void,
): void => {
  if (res === null) {
    return;
  }
  updateSpeechState(res, currentSpeech, setSpeech, setSilent);
};

/**
 * Applies a meta API response to state.
 * When `res` is `null` (fetch failed), no state update is performed so that
 * the last displayed stream state is preserved across transient API errors.
 */
export const applyMetaApiResponse = (
  res: { niconama?: AgentState } | null,
  setStreamState: (state: AgentState | undefined) => void,
): void => {
  if (res === null) {
    return;
  }
  setStreamState(res.niconama);
};

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
    applySpeechApiResponse(res, speech, setSpeech, setSilent);
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
    applyMetaApiResponse(res, setStreamState);
  });

  return (
    <AgentContext.Provider value={{ speech, silent, streamState, playing }}>
      {children}
    </AgentContext.Provider>
  );
};

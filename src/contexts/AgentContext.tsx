import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from "hono/jsx/dom";
import type { Games } from "../../lib/Agent/games";
import type { AgentState } from "../../lib/Agent/State";
import { useInterval } from "../hooks/useInterval";
import { updateSpeechState } from "./speechState";

type Data = {
  speech: string;
  silent: boolean;
  playing?: {
    name: keyof typeof Games;
    state: unknown;
  };
  streamState?: AgentState;
};

const AgentContext = createContext<Data>({
  speech: "",
  silent: false,
});

export const useAgentContext = () => useContext(AgentContext);

/**
 * Updates speech state from an `/api/speech` response.
 * When `res` is `null` (fetch failed), no state update is performed so that
 * the last displayed speech text is preserved across transient API errors.
 */
export const updateSpeechStateFromSpeechApiResponse = (
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
 * Updates stream state from an `/api/meta` response.
 * When `res` is `null` (fetch failed), no state update is performed so that
 * the last displayed stream state is preserved across transient API errors.
 */
export const setStreamStateFromMetaApiResponse = (
  res: { niconama?: AgentState } | null,
  setStreamState: (state: AgentState | undefined) => void,
): void => {
  if (res === null) {
    return;
  }
  setStreamState(res.niconama);
};

export const AgentProvider = ({ children }: PropsWithChildren) => {
  const [speech, setSpeech] = useState("");
  const [silent, setSilent] = useState(false);
  const [playing, setPlaying] = useState<Data["playing"]>();
  const [streamState, setStreamState] = useState<AgentState>();

  useInterval(100, async () => {
    const res = await fetch("/api/speech", { unix: "./var/api-speech.sock" })
      .then((res) => (res.ok ? res.json() : null))
      .catch((err) => {
        console.warn("[WARN]", err);
        return null;
      });
    updateSpeechStateFromSpeechApiResponse(res, speech, setSpeech, setSilent);
  });

  useInterval(100, async () => {
    const res = await fetch("/api/game", { unix: "./var/api-game.sock" })
      .then((res) => (res.ok ? res.json() : { error: "not ok" }))
      .catch((error) => ({ error }));
    if (res?.name) {
      setPlaying(res);
    }
  });

  useInterval(100, async () => {
    const res = await fetch("/api/meta", { unix: "./var/api-meta.sock" })
      .then((res) => (res.ok ? res.json() : null))
      .catch((error) => {
        console.warn("[WARN]", error);
        return null;
      });
    setStreamStateFromMetaApiResponse(res, setStreamState);
  });

  const prevTypeRef = useRef<string | undefined>(undefined);
  const prevTitleRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const currentType =
      streamState && typeof streamState === "object"
        ? streamState.type
        : undefined;
    const currentTitle =
      streamState &&
      typeof streamState === "object" &&
      streamState.meta &&
      typeof streamState.meta.title === "string"
        ? streamState.meta.title
        : undefined;

    const prevType = prevTypeRef.current;
    const prevTitle = prevTitleRef.current;

    // Reload when the stream transitions from live -> offline, or when the
    // same program URL becomes marked with the explicit "公開終了" marker
    // for the first time (title transitions from non-ended to ended).
    try {
      if (currentType === undefined && prevType === "live") {
        window.location.reload();
        return;
      }

      if (
        currentTitle?.includes("公開終了") &&
        !prevTitle?.includes("公開終了")
      ) {
        window.location.reload();
        return;
      }
    } catch {
      // ignore reload errors in environments where window is unavailable
    }

    prevTypeRef.current = currentType;
    prevTitleRef.current = currentTitle;
  }, [streamState]);

  return (
    <AgentContext.Provider value={{ speech, silent, streamState, playing }}>
      {children}
    </AgentContext.Provider>
  );
};

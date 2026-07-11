/**
 * Dynamic AGT agent API wiring: fallback in-memory agent, then optional createAgentApi.
 * Preserves single `let agent` replacement race and initialization logs.
 */

import { writeFileSync } from "node:fs";

export type FallbackAgent = {
  setSpeech: (text: string) => void;
  getSpeech: () => { speech: string; silent: boolean };
  getGame: () => null;
  getStreamState: () => unknown;
  publishStreamState: (data: unknown) => void;
  postComments: (_: unknown) => void;
};

export type AgentLikeHost = {
  canSpeak: boolean;
  currentGame?: unknown;
  streamState?: unknown;
  onAir: (state: unknown) => void;
  // Parameter type is contravariant; accept any array (AGT AgentComment[] at runtime).
  listen: (comments: any[]) => void;
};

export const createFallbackAgent = (
  getLastPublished: () => unknown,
  setLastPublished: (data: unknown) => void,
  getSpeechState: () => { speech: string; silent: boolean },
  setSpeechState: (state: { speech: string; silent: boolean }) => void,
): FallbackAgent => ({
  setSpeech: (text: string) => { setSpeechState({ speech: text, silent: false }); },
  getSpeech: () => getSpeechState(),
  getGame: () => null,
  getStreamState: () => getLastPublished(),
  publishStreamState: (data: unknown) => { setLastPublished(data); },
  postComments: (_: unknown) => { },
});

/**
 * Attempt dynamic import of createAgentApi. Returns the external agent or undefined on failure.
 */
export const tryCreateExternalAgentApi = async (
  streamer: AgentLikeHost,
): Promise<unknown | undefined> => {
  try {
    const mod = await import("automated-gameplay-transmitter");
    if (typeof mod.createAgentApi === "function") {
      try {
        const externalAgent = mod.createAgentApi(streamer as any);
        console.info("[INFO] external agent API initialized");
        return externalAgent;
      } catch (err) {
        console.warn("[WARN] createAgentApi threw, keeping in-memory fallback:", err instanceof Error ? err.message : String(err));
        return undefined;
      }
    }
    console.warn("[WARN] automated-gameplay-transmitter did not export createAgentApi; using fallback agent");
    return undefined;
  } catch (err) {
    console.warn("[WARN] dynamic import failed, continuing with in-memory fallback agent:", err instanceof Error ? err.message : String(err));
    return undefined;
  }
};

/** Persist talk model JSON (PUT / model save). */
export const persistTalkModel = (
  modelFile: string | undefined,
  toJSON: () => string,
): void => {
  if (!modelFile) return;
  try {
    writeFileSync(modelFile, toJSON());
  } catch (err) {
    console.warn("[WARN]", "failed to write model", modelFile, err);
  }
};

/**
 * Dynamic AGT agent API wiring: fallback in-memory agent, then optional createAgentApi.
 * Prefers `automated-gameplay-transmitter/agent` (side-effect free) when available,
 * then falls back to the package root export.
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

type CreateAgentApiFn = (agent: AgentLikeHost, initialSpeech?: string) => unknown;

type AgentApiModule = {
  createAgentApi?: CreateAgentApiFn;
};

/**
 * Load createAgentApi without pulling React UI or Node IPC when the
 * `./agent` export is available (AGT ≥ 0.6.5).
 */
export const loadCreateAgentApi = async (): Promise<CreateAgentApiFn | undefined> => {
  // Prefer side-effect-free entry (Phase C).
  try {
    const agentMod = await import("automated-gameplay-transmitter/agent") as AgentApiModule;
    if (typeof agentMod.createAgentApi === "function") {
      return agentMod.createAgentApi;
    }
  } catch {
    // Package without ./agent export (pre-0.6.5) or unresolved path — fall through.
  }

  try {
    const rootMod = await import("automated-gameplay-transmitter") as AgentApiModule;
    if (typeof rootMod.createAgentApi === "function") {
      return rootMod.createAgentApi;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

/**
 * In-memory agent used before (or instead of) AGT createAgentApi.
 * When `forwardComments` is provided, PUT comments still reach the streamer
 * during the async import window / import-failure path.
 */
export const createFallbackAgent = (
  getLastPublished: () => unknown,
  setLastPublished: (data: unknown) => void,
  getSpeechState: () => { speech: string; silent: boolean },
  setSpeechState: (state: { speech: string; silent: boolean }) => void,
  forwardComments?: (comments: unknown[]) => void,
): FallbackAgent => ({
  setSpeech: (text: string) => { setSpeechState({ speech: text, silent: false }); },
  getSpeech: () => getSpeechState(),
  getGame: () => null,
  getStreamState: () => getLastPublished(),
  publishStreamState: (data: unknown) => { setLastPublished(data); },
  postComments: (comments: unknown) => {
    if (!forwardComments) return;
    if (Array.isArray(comments)) {
      forwardComments(comments);
      return;
    }
    // Defensive: treat non-array payloads as a single-element batch (should not happen via PUT).
    forwardComments([comments]);
  },
});

/**
 * Attempt dynamic import of createAgentApi. Returns the external agent or undefined on failure.
 */
export const tryCreateExternalAgentApi = async (
  streamer: AgentLikeHost,
): Promise<unknown | undefined> => {
  try {
    const createAgentApi = await loadCreateAgentApi();
    if (typeof createAgentApi !== "function") {
      console.warn("[WARN] automated-gameplay-transmitter did not export createAgentApi; using fallback agent");
      return undefined;
    }
    try {
      const externalAgent = createAgentApi(streamer);
      console.info("[INFO] external agent API initialized");
      return externalAgent;
    } catch (err) {
      console.warn("[WARN] createAgentApi threw, keeping in-memory fallback:", err instanceof Error ? err.message : String(err));
      return undefined;
    }
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

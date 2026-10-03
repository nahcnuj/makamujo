/**
 * Detect external edits of the Markov model file so the agent can be rebuilt
 * with the new model without restarting the server (#639).
 *
 * The complication is that the server *itself* rewrites the model file after
 * every comment batch (to persist the learned corpus across restarts). Without
 * an explicit self-write signal the watcher would rebuild the agent on every
 * `PUT /`, so callers must report their own writes through
 * {@link ModelHotReloadWatcher.noteSelfWrite}.
 *
 * Changes are confirmed across two consecutive samples so that editors which
 * write by "truncate then append" are not observed mid-write.
 */
import { statSync } from "node:fs";

export type ModelFileStamp = {
  mtimeMs: number;
  size: number;
};

/** Equality of two samples; a missing file is represented by `undefined`. */
export const isSameStamp = (
  a: ModelFileStamp | undefined,
  b: ModelFileStamp | undefined,
): boolean => {
  if (a === undefined || b === undefined) return a === b;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
};

/** Current stamp of `modelPath`, or `undefined` when it cannot be read. */
export const readModelFileStamp = (
  modelPath: string,
): ModelFileStamp | undefined => {
  try {
    const stats = statSync(modelPath);
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return undefined;
  }
};

export type ModelHotReloadOptions = {
  /** Path of the model file to watch. */
  modelPath: string;
  /**
   * Called with the settled new stamp once an external change is confirmed.
   * Receives the stamp so callers do not have to stat the file again.
   */
  onReload: (stamp: ModelFileStamp) => void | Promise<void>;
  /** Sampling interval. Defaults to 1s, matching the idle-speech timer. */
  pollIntervalMs?: number;
};

export type ModelHotReloadWatcher = {
  /**
   * Report a write the application performed itself, so it is not mistaken for
   * an external edit. Pass the stamp returned by the write when available.
   */
  noteSelfWrite: (stamp?: ModelFileStamp) => void;
  /** Take one sample immediately instead of waiting for the next tick. */
  poll: () => void;
  /** Stop polling. */
  stop: () => void;
  /** Stamp last observed on disk (including self writes). */
  readonly lastStamp: ModelFileStamp | undefined;
};

/** Number of consecutive identical samples required before reloading. */
const CONFIRM_SAMPLES = 2;

export const startModelHotReload = (
  options: ModelHotReloadOptions,
): ModelHotReloadWatcher => {
  const intervalMs = options.pollIntervalMs ?? 1_000;

  let lastStamp = readModelFileStamp(options.modelPath);
  let selfWriteStamp: ModelFileStamp | undefined;
  let candidateStamp: ModelFileStamp | undefined;
  let candidateSamples = 0;

  const poll = (): void => {
    const stamp = readModelFileStamp(options.modelPath);

    if (isSameStamp(stamp, lastStamp)) {
      candidateStamp = undefined;
      candidateSamples = 0;
      return;
    }

    // The application just wrote this; adopt it without reloading.
    if (isSameStamp(stamp, selfWriteStamp)) {
      console.info(
        `[INFO] model file changed by this process (${stamp?.size ?? 0} bytes); not rebuilding`,
      );
      lastStamp = stamp;
      candidateStamp = undefined;
      candidateSamples = 0;
      return;
    }

    if (!isSameStamp(stamp, candidateStamp)) {
      candidateStamp = stamp;
      candidateSamples = 1;
      return;
    }

    candidateSamples += 1;
    if (candidateSamples < CONFIRM_SAMPLES) {
      return;
    }

    lastStamp = stamp;
    candidateStamp = undefined;
    candidateSamples = 0;
    if (stamp === undefined) {
      // The file was removed or renamed away. Rebuilding now would replace a
      // working model with an empty one; the agent keeps running and the next
      // persist re-creates the file (as a self write).
      console.info("[INFO] model file disappeared; keeping the loaded model");
      return;
    }
    console.info(
      `[INFO] model file changed outside this process; rebuilding agent (${stamp.size} bytes)`,
    );
    // Wrapped in an async thunk so a *synchronous* throw from onReload also
    // becomes a rejected promise instead of escaping the poll.
    void (async () => options.onReload(stamp))().catch((err) => {
      console.warn(
        "[WARN] failed to reload the model file:",
        options.modelPath,
        err instanceof Error ? err.message : String(err),
      );
    });
  };

  const timer = setInterval(poll, intervalMs);

  return {
    noteSelfWrite: (stamp) => {
      selfWriteStamp = stamp ?? readModelFileStamp(options.modelPath);
      // A pending external change is superseded by our own write.
      candidateStamp = undefined;
      candidateSamples = 0;
    },
    poll,
    stop: () => clearInterval(timer),
    get lastStamp() {
      return lastStamp;
    },
  };
};

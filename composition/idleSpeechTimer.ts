/**
 * Idle speech loop: when speechable, enqueue a default generate/speech once per tick.
 * Uses a classic setInterval (not async iterator) for process liveness.
 */

export type IdleSpeechStreamer = {
  speechable: boolean;
  speech: () => Promise<void>;
};

export const startIdleSpeechTimer = (
  streamer: IdleSpeechStreamer,
  intervalMs = 1_000,
): ReturnType<typeof setInterval> => {
  let running = false;
  return setInterval(async () => {
    if (!running && streamer.speechable) {
      try {
        running = true;
        await streamer.speech();
      } finally {
        running = false;
      }
    }
  }, intervalMs);
};

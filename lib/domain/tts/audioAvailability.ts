/**
 * Audio output availability policy.
 *
 * A dead PulseAudio/PipeWire backend makes every player fail within
 * milliseconds. Without a brake that is an unbounded spin: each utterance pays
 * full `open_jtalk` synthesis and spawns two player processes, none of which is
 * ever audible. Once failures accumulate, stop paying that cost for a cooldown
 * window, then probe again so a recovered backend resumes on its own.
 *
 * Pure: the caller owns the state and the clock.
 */

/** Consecutive total playback failures before playback is suppressed. */
export const AUDIO_FAILURE_THRESHOLD = 3;

/** How long playback stays suppressed once the threshold is reached. */
export const AUDIO_FAILURE_COOLDOWN_MS = 30_000;

export type AudioAvailability = {
  consecutiveFailures: number;
  suppressedUntil: number;
};

export const initialAudioAvailability = (): AudioAvailability => ({
  consecutiveFailures: 0,
  suppressedUntil: 0,
});

/** Whether this utterance may synthesise and play at all. */
export const isAudioAvailable = (
  availability: AudioAvailability,
  now: number,
): boolean => now >= availability.suppressedUntil;

/**
 * True while suppressed. Comparing this across the transition (false before a
 * failure, true after) yields exactly one notice per outage.
 */
export const isAudioSuppressed = (
  availability: AudioAvailability,
  now: number,
): boolean =>
  availability.consecutiveFailures >= AUDIO_FAILURE_THRESHOLD &&
  now < availability.suppressedUntil;

export const recordAudioSuccess = (): AudioAvailability =>
  initialAudioAvailability();

/**
 * Count a total failure. Failures below the threshold leave any earlier
 * suppression window untouched; reaching the threshold (re-)arms the cooldown,
 * which is what re-arms it after each probe that fails.
 */
export const recordAudioFailure = (
  availability: AudioAvailability,
  now: number,
): AudioAvailability => {
  const consecutiveFailures = availability.consecutiveFailures + 1;
  return {
    consecutiveFailures,
    suppressedUntil:
      consecutiveFailures >= AUDIO_FAILURE_THRESHOLD
        ? now + AUDIO_FAILURE_COOLDOWN_MS
        : availability.suppressedUntil,
  };
};

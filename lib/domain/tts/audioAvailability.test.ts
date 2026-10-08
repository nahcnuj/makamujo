import { describe, expect, it } from "bun:test";
import {
  AUDIO_FAILURE_COOLDOWN_MS,
  AUDIO_FAILURE_THRESHOLD,
  type AudioAvailability,
  initialAudioAvailability,
  isAudioAvailable,
  isAudioSuppressed,
  recordAudioFailure,
  recordAudioSuccess,
} from "./audioAvailability";

const failOnce = (
  availability: AudioAvailability,
  now: number,
): AudioAvailability => recordAudioFailure(availability, now);

const failTimes = (
  availability: AudioAvailability,
  now: number,
  times: number,
): AudioAvailability => {
  let next = availability;
  for (let i = 0; i < times; i++) {
    next = failOnce(next, now);
  }
  return next;
};

const failToThreshold = (now: number): AudioAvailability =>
  failTimes(initialAudioAvailability(), now, AUDIO_FAILURE_THRESHOLD);

const failBelowThreshold = (now: number): AudioAvailability =>
  failTimes(initialAudioAvailability(), now, AUDIO_FAILURE_THRESHOLD - 1);

describe("audioAvailability", () => {
  it("starts available and unsuppressed", () => {
    const availability = initialAudioAvailability();

    expect(isAudioAvailable(availability, 0)).toBe(true);
    expect(isAudioSuppressed(availability, 0)).toBe(false);
  });

  it("keeps playing while failures stay below the threshold", () => {
    const availability = failBelowThreshold(1_000);

    expect(isAudioAvailable(availability, 1_000)).toBe(true);
    expect(isAudioSuppressed(availability, 1_000)).toBe(false);
    expect(availability.consecutiveFailures).toBe(AUDIO_FAILURE_THRESHOLD - 1);
  });

  it("suppresses once the threshold is reached, and announces it once", () => {
    const before = failBelowThreshold(1_000);

    const after = failOnce(before, 1_000);

    expect(isAudioSuppressed(before, 1_000)).toBe(false);
    expect(isAudioSuppressed(after, 1_000)).toBe(true);
    expect(isAudioAvailable(after, 1_000)).toBe(false);
    expect(after.suppressedUntil).toBe(1_000 + AUDIO_FAILURE_COOLDOWN_MS);
  });

  it("keeps suppressing for the whole cooldown and probes once it expires", () => {
    const suppressed = failToThreshold(0);

    expect(isAudioAvailable(suppressed, AUDIO_FAILURE_COOLDOWN_MS - 1)).toBe(
      false,
    );
    expect(isAudioAvailable(suppressed, AUDIO_FAILURE_COOLDOWN_MS)).toBe(true);
    expect(isAudioSuppressed(suppressed, AUDIO_FAILURE_COOLDOWN_MS)).toBe(
      false,
    );
  });

  it("re-arms the cooldown when the probe after expiry fails again", () => {
    const expired = failToThreshold(0);
    const now = AUDIO_FAILURE_COOLDOWN_MS;

    const retried = failOnce(expired, now);

    expect(isAudioAvailable(retried, now)).toBe(false);
    expect(retried.suppressedUntil).toBe(now + AUDIO_FAILURE_COOLDOWN_MS);
  });

  it("clears the failure streak on success so later outages re-arm", () => {
    const suppressed = failToThreshold(0);

    const recovered = recordAudioSuccess();

    expect(recovered).toEqual(initialAudioAvailability());
    expect(isAudioSuppressed(recovered, 0)).toBe(false);
    expect(suppressed.consecutiveFailures).toBe(AUDIO_FAILURE_THRESHOLD);

    const singleFailure = failOnce(recovered, 10);
    expect(isAudioAvailable(singleFailure, 10)).toBe(true);
  });
});

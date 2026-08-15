import { describe, expect, it } from "bun:test";
import {
  FADE_OUT_MS,
  HIDDEN_FADING,
  isListenersStale,
  onListenersUpdate,
  SHOW_THEN_FADE,
  SPRITE_HIDE_THRESHOLD_MS,
  spriteAwayStyle,
  VISIBLE,
  visibilityFromSilenceClock,
} from "./spriteVisibility";

describe("isListenersStale", () => {
  it("is false just before threshold", () => {
    const t0 = 1_000_000;
    expect(isListenersStale(t0, t0 + SPRITE_HIDE_THRESHOLD_MS - 1)).toBe(false);
  });

  it("is true at and after threshold", () => {
    const t0 = 1_000_000;
    expect(isListenersStale(t0, t0 + SPRITE_HIDE_THRESHOLD_MS)).toBe(true);
    expect(isListenersStale(t0, t0 + SPRITE_HIDE_THRESHOLD_MS + 1)).toBe(true);
  });
});

describe("onListenersUpdate", () => {
  const nowMs = 5_000_000;

  it("returns null when listeners is undefined", () => {
    expect(
      onListenersUpdate({
        silent: true,
        listeners: undefined,
        prevListeners: 3,
        nowMs,
      }),
    ).toBeNull();
  });

  it("returns null when listeners did not change", () => {
    expect(
      onListenersUpdate({
        silent: true,
        listeners: 10,
        prevListeners: 10,
        nowMs,
      }),
    ).toBeNull();
  });

  it("tracks first observed count as a change", () => {
    const r = onListenersUpdate({
      silent: false,
      listeners: 1,
      prevListeners: undefined,
      nowMs,
    });
    expect(r).toEqual({
      prevListeners: 1,
      listenersChangedAtMs: nowMs,
      visibility: VISIBLE,
    });
  });

  it("while not silent: change keeps visible without fade", () => {
    const r = onListenersUpdate({
      silent: false,
      listeners: 11,
      prevListeners: 10,
      nowMs,
    });
    expect(r?.visibility).toEqual(VISIBLE);
    expect(r?.listenersChangedAtMs).toBe(nowMs);
  });

  it("while silent: change schedules show-then-fade (no threshold wait)", () => {
    const r = onListenersUpdate({
      silent: true,
      listeners: 11,
      prevListeners: 10,
      nowMs,
    });
    expect(r?.visibility).toEqual(SHOW_THEN_FADE);
    expect(r?.prevListeners).toBe(11);
  });
});

describe("visibilityFromSilenceClock", () => {
  const changedAt = 1_000_000;

  it("always visible when not silent", () => {
    expect(
      visibilityFromSilenceClock({
        silent: false,
        listenersChangedAtMs: changedAt,
        nowMs: changedAt + SPRITE_HIDE_THRESHOLD_MS * 10,
      }),
    ).toEqual(VISIBLE);
  });

  it("stays visible while silent but listeners not yet stale", () => {
    expect(
      visibilityFromSilenceClock({
        silent: true,
        listenersChangedAtMs: changedAt,
        nowMs: changedAt + SPRITE_HIDE_THRESHOLD_MS - 1,
      }),
    ).toEqual(VISIBLE);
  });

  it("hides with fade when silent and listeners stale", () => {
    expect(
      visibilityFromSilenceClock({
        silent: true,
        listenersChangedAtMs: changedAt,
        nowMs: changedAt + SPRITE_HIDE_THRESHOLD_MS,
      }),
    ).toEqual(HIDDEN_FADING);
  });
});

describe("spriteAwayStyle", () => {
  it("visible: brightness(1), no transition", () => {
    expect(spriteAwayStyle(VISIBLE)).toEqual({
      filter: "brightness(1)",
      transition: "none",
    });
  });

  it("fading out: brightness(0) with linear filter transition", () => {
    expect(spriteAwayStyle(HIDDEN_FADING)).toEqual({
      filter: "brightness(0)",
      transition: `filter ${FADE_OUT_MS}ms linear`,
    });
    expect(spriteAwayStyle(SHOW_THEN_FADE)).toEqual({
      filter: "brightness(0)",
      transition: `filter ${FADE_OUT_MS}ms linear`,
    });
  });
});

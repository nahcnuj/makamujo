import { describe, expect, it } from "bun:test";
import {
  FADE_OUT_MS,
  HIDDEN_FADING,
  SHOW_THEN_FADE,
  SPRITE_HIDE_THRESHOLD_MS,
  VISIBLE,
  isListenersStale,
  onListenersUpdate,
  spriteOpacityStyle,
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

describe("spriteOpacityStyle", () => {
  it("visible: opacity 1, no transition", () => {
    expect(spriteOpacityStyle(VISIBLE)).toEqual({
      opacity: 1,
      transition: "none",
    });
  });

  it("fading out: opacity 0 with linear transition", () => {
    expect(spriteOpacityStyle(HIDDEN_FADING)).toEqual({
      opacity: 0,
      transition: `opacity ${FADE_OUT_MS}ms linear`,
    });
    expect(spriteOpacityStyle(SHOW_THEN_FADE)).toEqual({
      opacity: 0,
      transition: `opacity ${FADE_OUT_MS}ms linear`,
    });
  });
});
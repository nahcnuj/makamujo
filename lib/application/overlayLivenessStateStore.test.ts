import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadOverlayLivenessState,
  parseOverlayLivenessState,
  saveOverlayLivenessState,
} from "./overlayLivenessStateStore";

describe("parseOverlayLivenessState", () => {
  it("returns a fresh state for non-objects", () => {
    expect(parseOverlayLivenessState(null)).toEqual({
      lastBeaconAtMs: undefined,
      lastRecoveryAtMs: undefined,
    });
    expect(parseOverlayLivenessState("nope")).toEqual({
      lastBeaconAtMs: undefined,
      lastRecoveryAtMs: undefined,
    });
  });

  it("coerces only non-negative integers", () => {
    expect(
      parseOverlayLivenessState({
        lastBeaconAtMs: 1234,
        lastRecoveryAtMs: 5678,
      }),
    ).toEqual({ lastBeaconAtMs: 1234, lastRecoveryAtMs: 5678 });
    expect(
      parseOverlayLivenessState({
        lastBeaconAtMs: -1,
        lastRecoveryAtMs: 1.5,
      }),
    ).toEqual({ lastBeaconAtMs: undefined, lastRecoveryAtMs: undefined });
    expect(parseOverlayLivenessState({ lastBeaconAtMs: Number.NaN })).toEqual({
      lastBeaconAtMs: undefined,
      lastRecoveryAtMs: undefined,
    });
  });
});

describe("overlayLivenessStateStore", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("loads a fresh state when the file does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "overlay-liveness-"));
    const state = loadOverlayLivenessState(join(dir, "missing.json"));
    expect(state).toEqual({
      lastBeaconAtMs: undefined,
      lastRecoveryAtMs: undefined,
    });
  });

  it("persists and reloads the state atomically", () => {
    dir = mkdtempSync(join(tmpdir(), "overlay-liveness-"));
    const path = join(dir, "state.json");
    saveOverlayLivenessState(path, {
      lastBeaconAtMs: 100,
      lastRecoveryAtMs: 200,
    });
    expect(loadOverlayLivenessState(path)).toEqual({
      lastBeaconAtMs: 100,
      lastRecoveryAtMs: 200,
    });
    // The file is valid JSON that can be read by other tools.
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      lastBeaconAtMs: 100,
      lastRecoveryAtMs: 200,
    });
  });

  it("falls back to a fresh state when the file is corrupt", () => {
    dir = mkdtempSync(join(tmpdir(), "overlay-liveness-"));
    const path = join(dir, "broken.json");
    Bun.write(path, "{ broken");
    expect(loadOverlayLivenessState(path)).toEqual({
      lastBeaconAtMs: undefined,
      lastRecoveryAtMs: undefined,
    });
  });
});

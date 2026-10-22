import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  createOverlayLivenessState,
  type OverlayLivenessState,
} from "../domain/broadcasting/OverlayLivenessPolicy";

export const OVERLAY_LIVENESS_STATE_BASENAME = "overlay-liveness-state.json";

const toNonNegativeInteger = (value: unknown): number | undefined => {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value)) return undefined;
  return value >= 0 ? value : undefined;
};

/**
 * Coerce arbitrary (possibly corrupt) parsed JSON into an OverlayLivenessState.
 * Invalid fields fall back to the fresh-session defaults so a bad file never
 * crashes startup.
 */
export const parseOverlayLivenessState = (
  raw: unknown,
): OverlayLivenessState => {
  const record =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : undefined;
  return {
    lastBeaconAtMs: toNonNegativeInteger(record?.lastBeaconAtMs),
    lastRecoveryAtMs: toNonNegativeInteger(record?.lastRecoveryAtMs),
  };
};

export const loadOverlayLivenessState = (
  filePath: string,
): OverlayLivenessState => {
  if (!existsSync(filePath)) {
    return createOverlayLivenessState();
  }
  try {
    return parseOverlayLivenessState(
      JSON.parse(readFileSync(filePath, "utf8")),
    );
  } catch (err) {
    console.warn(
      "[WARN] failed to read the overlay liveness state, starting fresh:",
      err instanceof Error ? err.message : String(err),
    );
    return createOverlayLivenessState();
  }
};

/**
 * Persist the liveness state with an atomic replace (write a sibling temp
 * file, then rename over the target). The cron job restarts the server every
 * 11 minutes, so the state has to survive the restart for the last beacon and
 * the cooldown of a recovery to stay meaningful. A plain `writeFileSync` can
 * leave a truncated file when the process is killed mid-write; the rename is a
 * single filesystem operation, so readers only ever observe the old or the
 * new complete file.
 */
export const saveOverlayLivenessState = (
  filePath: string,
  state: OverlayLivenessState,
): void => {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(tempPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tempPath);
    } catch {
      // The temp file may never have been created; cleanup is best-effort.
    }
    console.warn(
      "[WARN] failed to persist the overlay liveness state:",
      err instanceof Error ? err.message : String(err),
    );
  }
};

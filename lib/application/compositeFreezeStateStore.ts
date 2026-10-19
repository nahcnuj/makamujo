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
  COMPOSITE_FREEZE_RECOVERIES,
  type CompositeFreezeState,
  createCompositeFreezeState,
} from "../domain/broadcasting/CompositeFreezePolicy";

export const COMPOSITE_FREEZE_STATE_BASENAME = "broadcast-freeze-state.json";

const toNonNegativeInteger = (value: unknown): number | undefined => {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value)) return undefined;
  return value >= 0 ? value : undefined;
};

const toPositiveNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value > 0 ? value : undefined;
};

/**
 * Coerce arbitrary (possibly corrupt) parsed JSON into a CompositeFreezeState.
 * Invalid fields fall back to the fresh-session defaults so a bad file never
 * crashes startup; a rung index beyond the ladder is clamped to the deepest
 * rung, the same as the policy does when the ladder is already at the bottom.
 */
export const parseCompositeFreezeState = (
  raw: unknown,
): CompositeFreezeState => {
  const record =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : undefined;
  return {
    stillCycles: toNonNegativeInteger(record?.stillCycles) ?? 0,
    recoveryIndex: Math.min(
      toNonNegativeInteger(record?.recoveryIndex) ?? 0,
      COMPOSITE_FREEZE_RECOVERIES.length - 1,
    ),
    lastRecoveryAtMs: toPositiveNumber(record?.lastRecoveryAtMs),
  };
};

export const loadCompositeFreezeState = (
  filePath: string,
): CompositeFreezeState => {
  if (!existsSync(filePath)) {
    return createCompositeFreezeState();
  }
  try {
    return parseCompositeFreezeState(
      JSON.parse(readFileSync(filePath, "utf8")),
    );
  } catch (err) {
    console.warn(
      "[WARN] failed to read the composite freeze state, starting fresh:",
      err instanceof Error ? err.message : String(err),
    );
    return createCompositeFreezeState();
  }
};

/**
 * Persist the freeze state with an atomic replace (write a sibling temp file,
 * then rename over the target). The cron job restarts the server every 11
 * minutes, which is longer than the time the escalation ladder needs to reach
 * its deepest rung, so this state only helps if it survives those restarts.
 * A plain `writeFileSync` can leave a truncated file when the process is
 * killed mid-write; the rename is a single filesystem operation, so readers
 * only ever observe the old or the new complete file.
 */
export const saveCompositeFreezeState = (
  filePath: string,
  state: CompositeFreezeState,
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
      "[WARN] failed to persist the composite freeze state:",
      err instanceof Error ? err.message : String(err),
    );
  }
};

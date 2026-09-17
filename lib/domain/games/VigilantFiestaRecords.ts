/**
 * Session (枠内) vs all-time (通算) high-score bookkeeping for vigilant-fiesta.
 * Slot bests are keyed by stream URL + start so process restarts keep 枠内 display.
 */

export type ScoreRecords = {
  /** Best score in the current stream slot (枠内). */
  sessionBest: number;
  /** Best score across all slots / restarts (通算). */
  allTimeBest: number;
};

export type SlotScoreEntry = {
  sessionBest: number;
  /** Unix ms when this slot entry was last updated. */
  updatedAt: number;
};

export type StoredHighscores = {
  allTimeBest: number;
  /** Keyed by {@link buildSlotKey}. */
  slots: Record<string, SlotScoreEntry>;
};

/** How many recent 枠 entries to keep in JSON. */
export const MAX_STORED_SLOTS = 32;

export const emptyScoreRecords = (): ScoreRecords => ({
  sessionBest: 0,
  allTimeBest: 0,
});

export const emptyStoredHighscores = (): StoredHighscores => ({
  allTimeBest: 0,
  slots: {},
});

/**
 * Identify a 配信枠 by program URL (e.g. …/lvXXXXX).
 * Returns undefined when the stream URL is not yet known.
 */
export const buildSlotKey = (input: {
  url?: string | null;
  /** Ignored; kept for call-site compatibility. */
  start?: number | null;
}): string | undefined => {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!url) return undefined;
  return url;
};

const asNonNegInt = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return undefined;
  return Math.trunc(value);
};

/** Reject prototype-polluting keys from untrusted JSON slot maps. */
const isSafeSlotKey = (key: string): boolean =>
  key !== "__proto__" && key !== "constructor" && key !== "prototype";

/**
 * Build a plain slots object via Map so untrusted keys never write through
 * Object.prototype (js/remote-property-injection).
 */
const slotsFromEntries = (
  entries: Iterable<[string, SlotScoreEntry]>,
): Record<string, SlotScoreEntry> => {
  const slotMap = new Map<string, SlotScoreEntry>();
  for (const [key, entry] of entries) {
    if (!key || !isSafeSlotKey(key)) continue;
    slotMap.set(key, entry);
  }
  return Object.fromEntries(slotMap);
};

export const parseStoredHighscores = (raw: string): StoredHighscores => {
  const empty = emptyStoredHighscores();
  try {
    const parsed = JSON.parse(raw) as {
      allTimeBest?: unknown;
      slots?: unknown;
      // legacy single-field file from earlier version
    };
    const allTimeBest = asNonNegInt(parsed.allTimeBest) ?? 0;
    const slotEntries: Array<[string, SlotScoreEntry]> = [];
    if (
      parsed.slots !== null &&
      typeof parsed.slots === "object" &&
      !Array.isArray(parsed.slots)
    ) {
      for (const [key, entry] of Object.entries(
        parsed.slots as Record<string, unknown>,
      )) {
        if (!key || entry === null || typeof entry !== "object") continue;
        const e = entry as { sessionBest?: unknown; updatedAt?: unknown };
        const sessionBest = asNonNegInt(e.sessionBest);
        const updatedAt = asNonNegInt(e.updatedAt) ?? 0;
        if (sessionBest === undefined) continue;
        slotEntries.push([key, { sessionBest, updatedAt }]);
      }
    }
    return { allTimeBest, slots: slotsFromEntries(slotEntries) };
  } catch {
    return empty;
  }
};

/** @deprecated Use parseStoredHighscores; kept for call-site clarity in tests. */
export const parseStoredAllTimeBest = (raw: string): number =>
  parseStoredHighscores(raw).allTimeBest;

export const pruneSlots = (
  slots: Record<string, SlotScoreEntry>,
  maxSlots: number = MAX_STORED_SLOTS,
  keepKey?: string,
): Record<string, SlotScoreEntry> => {
  const entries = Object.entries(slots).filter(([key]) => isSafeSlotKey(key));
  if (entries.length <= maxSlots) {
    return slotsFromEntries(entries);
  }

  entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const kept = entries.slice(0, maxSlots);
  const keepEntry =
    keepKey && isSafeSlotKey(keepKey) ? slots[keepKey] : undefined;
  if (keepKey && keepEntry && !kept.some(([key]) => key === keepKey)) {
    // Ensure the active slot is never dropped when pruning.
    kept.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    kept.shift();
    kept.push([keepKey, keepEntry]);
  }
  return slotsFromEntries(kept);
};

export const serializeStoredHighscores = (
  stored: StoredHighscores,
  keepKey?: string,
): string => {
  const slots = pruneSlots(stored.slots, MAX_STORED_SLOTS, keepKey);
  return JSON.stringify({
    allTimeBest: Math.max(0, Math.trunc(stored.allTimeBest)),
    slots,
  });
};

/** @deprecated Prefer serializeStoredHighscores. */
export const serializeAllTimeBest = (allTimeBest: number): string =>
  serializeStoredHighscores({ allTimeBest, slots: {} });

/**
 * Raise session / all-time bests when `score` is a finite improvement.
 * Returns same object reference when nothing changes.
 */
export const updateScoreRecords = (
  records: ScoreRecords,
  score: unknown,
): ScoreRecords => {
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0) {
    return records;
  }
  const value = Math.trunc(score);
  const sessionBest = Math.max(records.sessionBest, value);
  const allTimeBest = Math.max(records.allTimeBest, value);
  if (
    sessionBest === records.sessionBest &&
    allTimeBest === records.allTimeBest
  ) {
    return records;
  }
  return { sessionBest, allTimeBest };
};

/** Apply in-memory records onto a stored snapshot for one slot. */
export const mergeRecordsIntoStored = (
  stored: StoredHighscores,
  records: ScoreRecords,
  slotKey: string | undefined,
  nowMs: number = Date.now(),
): StoredHighscores => {
  const allTimeBest = Math.max(stored.allTimeBest, records.allTimeBest);
  if (!slotKey) {
    if (allTimeBest === stored.allTimeBest) return stored;
    return { ...stored, allTimeBest };
  }
  if (!isSafeSlotKey(slotKey)) {
    if (allTimeBest === stored.allTimeBest) return stored;
    return { ...stored, allTimeBest };
  }
  const prev = stored.slots[slotKey];
  const sessionBest = Math.max(prev?.sessionBest ?? 0, records.sessionBest);
  const unchanged =
    allTimeBest === stored.allTimeBest &&
    prev !== undefined &&
    prev.sessionBest === sessionBest;
  if (unchanged) return stored;
  return {
    allTimeBest,
    slots: slotsFromEntries([
      ...Object.entries(stored.slots),
      [slotKey, { sessionBest, updatedAt: nowMs }],
    ]),
  };
};

export const recordsForSlot = (
  stored: StoredHighscores,
  slotKey: string | undefined,
): ScoreRecords => ({
  allTimeBest: stored.allTimeBest,
  sessionBest: slotKey ? (stored.slots[slotKey]?.sessionBest ?? 0) : 0,
});

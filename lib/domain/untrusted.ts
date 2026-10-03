/**
 * Narrowing helpers for values whose shape is not known at compile time: IPC
 * payloads, browser-extracted data and other third-party runtime values.
 *
 * These exist so that reading a field out of such a value does not need an `as`
 * assertion or an `any`. A type predicate narrows through the compiler's
 * control-flow analysis instead of asserting past it, which is what lets #686
 * clear the `noExplicitAny` warnings without hiding anything from the checker.
 *
 * Nothing here parses anything: when the value really is JSON, `JSON.parse`
 * produces it and these helpers only read a field out of the result.
 */

/** Narrow an unknown value to an indexable record without asserting. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Read a numeric field, or `undefined` when it is absent or not a number. */
export const readNumber = (value: unknown, key: string): number | undefined => {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "number" ? field : undefined;
};

/** Read a string field, or `undefined` when it is absent or not a string. */
export const readString = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
};

/**
 * Read an array-of-strings field, or `undefined` when it is absent or not an
 * array.
 *
 * Entries that are not strings are dropped rather than passed through, so the
 * caller gets a genuinely `string[]` and the type checker stays useful.
 */
export const readStrings = (
  value: unknown,
  key: string,
): string[] | undefined => {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  if (!Array.isArray(field)) return undefined;
  return field.filter((entry): entry is string => typeof entry === "string");
};

/**
 * Walk `keys` through nested objects and return the value at the end when it is
 * a string, otherwise `undefined`.
 *
 * Every step is checked, so a missing or non-object link ends the walk instead
 * of throwing.
 */
export const readNestedString = (
  value: unknown,
  keys: readonly string[],
): string | undefined => {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return typeof current === "string" ? current : undefined;
};

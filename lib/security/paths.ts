import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * True when `candidate` resolves inside `root` (or is exactly `root`).
 * Uses resolve + startsWith — the barrier CodeQL recognizes for path injection.
 */
export const isPathInside = (root: string, candidate: string): boolean => {
  if (!candidate || candidate.includes("\0")) return false;
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate === resolvedRoot) return true;
  const rootPrefix = resolvedRoot.endsWith(sep)
    ? resolvedRoot
    : `${resolvedRoot}${sep}`;
  return resolvedCandidate.startsWith(rootPrefix);
};

/**
 * Resolve `candidate` under `root`. Returns undefined when the result would
 * escape the root (including via `..` or absolute paths outside root).
 */
export const resolveInsideRoot = (
  root: string,
  candidate: string,
): string | undefined => {
  if (!candidate || candidate.includes("\0")) return undefined;
  const resolvedRoot = resolve(root);
  const resolvedCandidate = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(resolvedRoot, candidate);
  if (!isPathInside(resolvedRoot, resolvedCandidate)) return undefined;
  // relative() guard rejects Windows absolute paths that slip past startsWith.
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    return undefined;
  }
  return resolvedCandidate;
};

import { useEffect, useMemo, useState } from "hono/jsx/dom";

const MS_PER_CHAR = 45;
const MIN_MS = 200;
const MAX_MS = 2000;

const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

export function graphemeList(text: string): string[] {
  return [...graphemeSegmenter.segment(text)].map((s) => s.segment);
}

export function revealDurationMs(graphemeCount: number): number {
  return Math.min(MAX_MS, Math.max(MIN_MS, graphemeCount * MS_PER_CHAR));
}

export function revealCount(elapsedMs: number, durationMs: number, total: number): number {
  if (total <= 0) return 0;
  if (durationMs <= 0) return total;
  const t = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return Math.min(total, Math.ceil(t * total));
}

export function stripTrailingPeriod(text: string): string {
  return text.replace(/。$/, "");
}

export type RevealScheduler = {
  now: () => number;
  schedule: (cb: (t: number) => void) => number;
  cancel: (id: number) => void;
};

/** Returns cleanup. Drives `onCount` from 0 → total. */
export function runReveal(
  total: number,
  durationMs: number,
  onCount: (count: number) => void,
  scheduler: RevealScheduler,
): () => void {
  if (total <= 0) {
    onCount(0);
    return () => {};
  }

  onCount(0);
  const start = scheduler.now();
  let id = 0;

  const tick = (t: number) => {
    const next = revealCount(t - start, durationMs, total);
    onCount(next);
    if (next < total) {
      id = scheduler.schedule(tick);
    }
  };

  id = scheduler.schedule(tick);
  return () => scheduler.cancel(id);
}

export function SpeechLine({
  text,
  animate = true,
}: {
  text: string;
  animate?: boolean;
}) {
  const display = stripTrailingPeriod(text);
  const graphemes = useMemo(() => graphemeList(display), [display]);
  const [count, setCount] = useState(() => (animate ? 0 : graphemes.length));

  useEffect(() => {
    if (!animate) {
      setCount(graphemes.length);
      return;
    }

    const total = graphemes.length;
    if (total === 0) {
      setCount(0);
      return;
    }

    return runReveal(total, revealDurationMs(total), setCount, {
      now: () => performance.now(),
      schedule: (cb) => requestAnimationFrame(cb),
      cancel: (id) => cancelAnimationFrame(id),
    });
  }, [display, animate, graphemes.length]);

  return (
    <div className="overflow-hidden whitespace-pre-wrap break-all">
      {graphemes.slice(0, count).join("")}
    </div>
  );
}

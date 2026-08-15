import { useMemo } from "hono/jsx/dom";
import { ScreenReaderOnly } from "./ScreenReaderOnly";

const MS_PER_CHAR = 55;
const TIP_FADE_MS = 80;

const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

export function graphemeList(text: string): string[] {
  return [...graphemeSegmenter.segment(text)].map((s) => s.segment);
}

export function stripTrailingPeriod(text: string): string {
  return text.replace(/。$/, "");
}

export function animationDelayMs(index: number): number {
  return index * MS_PER_CHAR;
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

  return (
    <div className="relative overflow-hidden whitespace-pre-wrap break-all">
      <ScreenReaderOnly>{display}</ScreenReaderOnly>
      <div aria-hidden="true">
        {graphemes.map((g, i) => (
          <span
            // Grapheme order is stable for a given string; index is intentional.
            // biome-ignore lint/suspicious/noArrayIndexKey: per-character animation order
            key={`${i}:${g}`}
            style={
              animate
                ? {
                    opacity: 0,
                    animation: `speech-fade-in ${TIP_FADE_MS}ms ease-out forwards`,
                    animationDelay: `${animationDelayMs(i)}ms`,
                  }
                : undefined
            }
          >
            {g}
          </span>
        ))}
      </div>
    </div>
  );
}

const MS_PER_CHAR = 45;
const MIN_MS = 200;
const MAX_MS = 2000;

const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

function graphemeLength(text: string): number {
  let n = 0;
  for (const _ of graphemeSegmenter.segment(text)) n++;
  return n;
}

function revealDurationMs(text: string): number {
  return Math.min(MAX_MS, Math.max(MIN_MS, graphemeLength(text) * MS_PER_CHAR));
}

export function SpeechLine({
  text,
  animate = true,
}: {
  text: string;
  animate?: boolean;
}) {
  const display = text.replace(/。$/, "");
  const durationMs = animate ? revealDurationMs(display) : 0;

  return (
    <div
      className="overflow-hidden whitespace-pre-wrap break-all"
      style={
        animate
          ? {
              clipPath: "inset(0 100% 0 0)",
              animation: `speech-reveal-ltr ${durationMs}ms linear forwards`,
            }
          : undefined
      }
    >
      {display}
    </div>
  );
}

import { useEffect, useState } from "hono/jsx/dom";
import { inferNGramSize } from "../../lib/domain/broadcasting/NGramPolicy";

export const VOLTAGE_BASE_NGRAM = 2;
export const VOLTAGE_BASE_HEIGHT_EM = 0.5;
export const VOLTAGE_COLOR = "#6ee7b7";

export const VOLTAGE_BAR_HEIGHT = `${VOLTAGE_BASE_HEIGHT_EM}em`;

export const commonLog10 = (x: number): number => (x <= 0 ? 0 : Math.log10(x));

/**
 * Bar fill ratio [0,100] of the delivery voltage gauge.
 * The full width (100%) is reached at comment count `n + 1`, where `n` is the
 * utterance count at the end of the previous stream. The current comment count
 * is scaled by common log10 against that max.
 */
export const computeVoltageWidthPercent = (
  currentComments: number,
  previousStreamCommentCount: number,
): number => {
  const previousMax = previousStreamCommentCount + 1;
  const maxLog = commonLog10(previousMax);
  if (maxLog <= 0) {
    return currentComments > 0 ? 100 : 0;
  }
  return Math.min(100, (commonLog10(currentComments) / maxLog) * 100);
};

/** True when current comments exceed the previous stream's max = `n + 1`. */
export const isOverVoltage = (
  currentComments: number,
  previousStreamCommentCount: number,
): boolean => currentComments > previousStreamCommentCount + 1;

/** No prior stream and no comments yet: the gauge has nothing to show. */
export const shouldRenderVoltage = (
  currentComments: number,
  previousStreamCommentCount: number,
): boolean => previousStreamCommentCount > 0 || currentComments > 0;

export function getRainbowGradient(offset: number): string {
  return `linear-gradient(90deg, 
    hsl(${(offset + 0) % 360}, 100%, 50%),
    hsl(${(offset + 60) % 360}, 100%, 50%),
    hsl(${(offset + 120) % 360}, 100%, 50%),
    hsl(${(offset + 180) % 360}, 100%, 50%),
    hsl(${(offset + 240) % 360}, 100%, 50%),
    hsl(${(offset + 300) % 360}, 100%, 50%),
    hsl(${(offset + 360) % 360}, 100%, 50%)
  )`;
}

export const computeVoltageHeightEm = (nGram: number): number => {
  const safeNGram =
    Number.isFinite(nGram) && nGram >= 1 ? nGram : VOLTAGE_BASE_NGRAM;
  return (VOLTAGE_BASE_HEIGHT_EM / VOLTAGE_BASE_NGRAM) * safeNGram;
};

export const computeVoltageHeight = (nGram: number): string =>
  `${computeVoltageHeightEm(nGram)}em`;

export const computeVoltageNGram = (commentCount: number): number =>
  inferNGramSize(commentCount);

type DeliveryVoltageProps = {
  commentCount: number;
  previousStreamCommentCount: number;
  nGram?: number;
};

export function DeliveryVoltage({
  commentCount,
  previousStreamCommentCount,
  nGram = 1,
}: DeliveryVoltageProps) {
  const currentComments = commentCount;
  const previous = previousStreamCommentCount;

  const widthPercent = computeVoltageWidthPercent(currentComments, previous);
  const overVoltage = isOverVoltage(currentComments, previous);

  const voltageNGram =
    Number.isFinite(nGram) && nGram >= 1
      ? Math.floor(nGram)
      : VOLTAGE_BASE_NGRAM;

  const height = computeVoltageHeight(voltageNGram);

  const [rainbowOffset, setRainbowOffset] = useState(0);

  useEffect(() => {
    if (!overVoltage) return;
    const interval = setInterval(() => {
      setRainbowOffset((prev) => (prev + 2) % 360);
    }, 50);
    return () => clearInterval(interval);
  }, [overVoltage]);

  if (!shouldRenderVoltage(currentComments, previous)) {
    return null;
  }

  const rainbowGradient = getRainbowGradient(rainbowOffset);
  const borderColor = overVoltage ? undefined : VOLTAGE_COLOR;
  const borderImage = overVoltage ? `${rainbowGradient} 1` : undefined;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        backgroundColor: "rgba(0, 0, 0, 0.3)",
        borderRadius: "9999px",
        overflow: "visible",
        marginBottom: "0.5rem",
        border: "1px solid",
        borderColor,
        borderImage,
        textAlign: "right",
        lineHeight: height,
        transition: "height 0.3s ease-out, line-height 0.3s ease-out",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          borderRadius: "9999px",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: `${widthPercent}%`,
            height: "100%",
            backgroundColor: overVoltage ? undefined : VOLTAGE_COLOR,
            ...(overVoltage ? { background: rainbowGradient } : {}),
            transition: overVoltage ? "none" : "width 0.3s ease-out",
          }}
        />
      </div>
      <span
        style={{
          position: "absolute",
          right: "0.25rem",
          top: "50%",
          transform: "translateY(-50%)",
          color: "#f8fafc",
          fontSize: "0.4em",
          lineHeight: 1,
          pointerEvents: "none",
          whiteSpace: "nowrap",
          textShadow: "0 0 2px rgba(0, 0, 0, 0.9)",
          zIndex: 1,
        }}
      >
        {`${voltageNGram}-gram`}
      </span>
    </div>
  );
}

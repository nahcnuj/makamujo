import { useEffect, useState } from "hono/jsx/dom";
import { inferNGramSize } from "../../lib/domain/broadcasting/NGramPolicy";

const VOLTAGE_BASE_NGRAM = 2;
const VOLTAGE_BASE_HEIGHT_EM = 0.5;

export const VOLTAGE_BAR_HEIGHT = "0.5em";

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

export const getVoltageHeight = computeVoltageHeight;
export const getVoltageHeightEm = computeVoltageHeightEm;
export const computeVoltageBarHeight = computeVoltageHeight;
export const getVoltageBarHeight = computeVoltageHeight;
export const computeNGramHeight = computeVoltageHeight;
export const getNGramHeight = computeVoltageHeight;

// Additional aliases (number-valued height in em units).
export const computeVoltageHeightValue = computeVoltageHeightEm;
export const getVoltageHeightValue = computeVoltageHeightEm;
export const voltageHeight = computeVoltageHeightEm;
export const voltageHeightEm = computeVoltageHeightEm;
export const computeVoltageHeightNumber = computeVoltageHeightEm;
export const getVoltageHeightNumber = computeVoltageHeightEm;

export const computeVoltageNGram = (commentCount: number): number =>
  inferNGramSize(commentCount);

export const getVoltageNGram = computeVoltageNGram;
export const inferVoltageNGram = computeVoltageNGram;

type DeliveryVoltageProps = {
  commentCount: number;
  previousStreamCommentCount: number;
  nGram?: number;
  n?: number;
};

export function DeliveryVoltage({
  commentCount,
  previousStreamCommentCount,
  nGram,
  n,
}: DeliveryVoltageProps) {
  const currentComments = commentCount;
  const previous = previousStreamCommentCount;

  const widthPercent = computeVoltageWidthPercent(currentComments, previous);
  const overVoltage = isOverVoltage(currentComments, previous);

  const voltageNGram =
    nGram !== undefined && Number.isFinite(nGram) && nGram >= 1
      ? Math.floor(nGram)
      : n !== undefined && Number.isFinite(n) && n >= 1
        ? Math.floor(n)
        : inferNGramSize(currentComments);

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

  const borderColor = overVoltage ? undefined : "#6ee7b7";
  const borderImage = overVoltage
    ? `${getRainbowGradient(rainbowOffset)} 1`
    : undefined;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height,
        backgroundColor: "rgba(0, 0, 0, 0.3)",
        borderRadius: "9999px",
        overflow: "hidden",
        marginBottom: "0.5rem",
        border: "1px solid",
        borderColor,
        borderImage,
        transition: "height 0.3s ease-out",
      }}
    >
      <div
        className="bg-emerald-300"
        style={{
          width: `${widthPercent}%`,
          height: "100%",
          ...(overVoltage
            ? { background: getRainbowGradient(rainbowOffset) }
            : {}),
          transition: overVoltage ? "none" : "width 0.3s ease-out",
        }}
      />
      <span
        style={{
          position: "absolute",
          right: "0.25rem",
          top: "50%",
          transform: "translateY(-50%)",
          color: "#111111",
          textAlign: "right",
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}
      >
        {`${voltageNGram}-gram`}
      </span>
    </div>
  );
}

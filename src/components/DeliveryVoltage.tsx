import { useEffect, useState } from "hono/jsx/dom";
import { useAgentContext } from "../contexts/AgentContext";

const VOLTAGE_BAR_HEIGHT = "0.5em";
const BRAND_COLOR = "#6ee7b7";

export const commonLog10 = (x: number): number => (x <= 0 ? 0 : Math.log10(x));

/**
 * Bar fill ratio [0,100] of the delivery voltage gauge.
 * The full width (100%) equals the comment count `n + 1` at the end of the
 * previous stream, scaled by common log10 of the current comment count.
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

export function DeliveryVoltage() {
  const { commentCount, previousStreamCommentCount } = useAgentContext();

  const currentComments = commentCount ?? 0;
  const previous = previousStreamCommentCount ?? 0;

  const widthPercent = computeVoltageWidthPercent(currentComments, previous);
  const overVoltage = isOverVoltage(currentComments, previous);

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

  return (
    <div
      style={{
        width: "100%",
        height: VOLTAGE_BAR_HEIGHT,
        backgroundColor: "rgba(0, 0, 0, 0.3)",
        borderRadius: "9999px",
        overflow: "hidden",
        marginBottom: "0.5rem",
      }}
    >
      <div
        style={{
          width: `${widthPercent}%`,
          height: "100%",
          background: overVoltage
            ? getRainbowGradient(rainbowOffset)
            : BRAND_COLOR,
          transition: overVoltage ? "none" : "width 0.3s ease-out",
        }}
      />
    </div>
  );
}

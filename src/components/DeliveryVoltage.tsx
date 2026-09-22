import { useEffect, useState } from "hono/jsx/dom";
import { useAgentContext } from "../contexts/AgentContext";

const VOLTAGE_BAR_HEIGHT = "0.5em";
const BRAND_COLOR = "#10b981";

function commonLog10(x: number): number {
  if (x <= 0) return 0;
  return Math.log10(x);
}

function getRainbowGradient(offset: number): string {
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
  const { streamState } = useAgentContext();

  const currentComments = streamState?.meta?.total?.comments ?? 0;
  const previousMax = (streamState?.previousStreamCommentCount ?? 0) + 1;

  const currentLog = commonLog10(currentComments);
  const maxLog = commonLog10(previousMax);

  const widthPercent =
    maxLog > 0 ? Math.min(100, (currentLog / maxLog) * 100) : 0;
  const isOverVoltage = currentComments > previousMax;

  const [rainbowOffset, setRainbowOffset] = useState(0);

  useEffect(() => {
    if (!isOverVoltage) return;
    const interval = setInterval(() => {
      setRainbowOffset((prev) => (prev + 2) % 360);
    }, 50);
    return () => clearInterval(interval);
  }, [isOverVoltage]);

  if (previousMax <= 1 && currentComments === 0) {
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
          background: isOverVoltage
            ? getRainbowGradient(rainbowOffset)
            : BRAND_COLOR,
          transition: isOverVoltage ? "none" : "width 0.3s ease-out",
        }}
      />
    </div>
  );
}

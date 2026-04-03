import { useEffect, useState } from "react";

/**
 * Calculates the rotation angle in degrees for the hour hand.
 * @param hours - Hours (0–23)
 * @param minutes - Minutes (0–59)
 */
export function calculateHourAngle(hours: number, minutes: number): number {
  return (hours % 12) * 30 + minutes * 0.5;
}

/**
 * Calculates the rotation angle in degrees for the minute hand.
 * @param minutes - Minutes (0–59)
 * @param seconds - Seconds (0–59)
 */
export function calculateMinuteAngle(minutes: number, seconds: number): number {
  return minutes * 6 + seconds * 0.1;
}

/**
 * Calculates the rotation angle in degrees for the second hand.
 * @param seconds - Seconds (0–59)
 */
export function calculateSecondAngle(seconds: number): number {
  return seconds * 6;
}

interface AnalogClockProps {
  /** Tailwind background color utility class, e.g. "bg-black" */
  backgroundColor: `bg-${string}`;
  /** Color of the clock dial (face and hour markers) */
  dialColor: string;
  /** Color of the hour hand */
  hourHandColor: string;
  /** Color of the minute hand */
  minuteHandColor: string;
  /** Color of the second hand */
  secondHandColor: string;
}

/**
 * AnalogClock displays a live analog clock.
 * Fills its parent container at a 1:1 aspect ratio and is always rendered
 * at the foreground of the streaming screen.
 */
export function AnalogClock({
  backgroundColor,
  dialColor,
  hourHandColor,
  minuteHandColor,
  secondHandColor,
}: AnalogClockProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  const hourAngle = calculateHourAngle(hours, minutes);
  const minuteAngle = calculateMinuteAngle(minutes, seconds);
  const secondAngle = calculateSecondAngle(seconds);

  return (
    <div className={`w-full aspect-square z-50 ${backgroundColor}`}>
      <svg viewBox="0 0 100 100" className="w-full h-full">
        {/* Clock dial */}
        <circle cx="50" cy="50" r="48" fill="none" stroke={dialColor} strokeWidth="2" />

        {/* Hour markers */}
        {Array.from({ length: 12 }, (_, i) => {
          const angle = (i * 30 * Math.PI) / 180;
          const x1 = 50 + 40 * Math.sin(angle);
          const y1 = 50 - 40 * Math.cos(angle);
          const x2 = 50 + 46 * Math.sin(angle);
          const y2 = 50 - 46 * Math.cos(angle);
          return (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={dialColor} strokeWidth="2" strokeLinecap="round" />
          );
        })}

        {/* Hour hand */}
        <line
          x1="50" y1="50"
          x2="50" y2="24"
          stroke={hourHandColor}
          strokeWidth="4"
          strokeLinecap="round"
          transform={`rotate(${hourAngle}, 50, 50)`}
        />

        {/* Minute hand */}
        <line
          x1="50" y1="50"
          x2="50" y2="14"
          stroke={minuteHandColor}
          strokeWidth="3"
          strokeLinecap="round"
          transform={`rotate(${minuteAngle}, 50, 50)`}
        />

        {/* Second hand */}
        <line
          x1="50" y1="56"
          x2="50" y2="10"
          stroke={secondHandColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          transform={`rotate(${secondAngle}, 50, 50)`}
        />

        {/* Center pivot */}
        <circle cx="50" cy="50" r="3" fill={secondHandColor} />
      </svg>
    </div>
  );
}

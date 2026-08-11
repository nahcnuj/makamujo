import type { State } from "./State";

const formatNumber = new Intl.NumberFormat("ja-JP").format;

export const GAME_PUBLIC_URL = "http://www.nahcnuj.work/vigilant-fiesta/";

const asFinite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export default function ({ state }: { state: State }) {
  const score = asFinite(state.score);
  const level = asFinite(state.level);
  const sessionBest = asFinite(state.sessionBest) ?? 0;
  const allTimeBest = asFinite(state.allTimeBest) ?? 0;

  return (
    <div className="flex flex-col gap-2 items-stretch">
      <div className="flex flex-col gap-0.5">
        {score !== undefined ? <div>{`Score ${formatNumber(score)}`}</div> : null}
        {level !== undefined ? <div>{`Level ${formatNumber(level)}`}</div> : null}
        <div>{`最高(枠内) ${formatNumber(sessionBest)}`}</div>
        <div>{`最高(通算) ${formatNumber(allTimeBest)}`}</div>
      </div>
      <div className="flex flex-col items-center gap-1 mt-2">
        <img
          src="/vigilant-fiesta-qr.svg"
          alt={`QR: ${GAME_PUBLIC_URL}`}
          width={120}
          height={120}
          className="bg-white rounded-sm p-1 w-[7.5rem] h-[7.5rem]"
        />
      </div>
    </div>
  );
}

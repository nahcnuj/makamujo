import type { State } from "./State";

const formatNumber = new Intl.NumberFormat("ja-JP").format;

export const GAME_PUBLIC_URL = "http://www.nahcnuj.work/vigilant-fiesta/";

const asFinite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export default function ({ state }: { state: State }) {
  const sessionBest = asFinite(state.sessionBest) ?? 0;
  const allTimeBest = asFinite(state.allTimeBest) ?? 0;

  return (
    <div className="flex flex-col gap-2 items-stretch">
      <div className="flex flex-col gap-0.5">
        <div>
          <div>本枠最高得点</div>
          <div>{formatNumber(sessionBest)}</div>
        </div>
        <div>
          <div>通算最高得点</div>
          <div>{formatNumber(allTimeBest)}</div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 mt-2">
        <img
          src="/vigilant-fiesta-qr.svg"
          alt={`QR: ${GAME_PUBLIC_URL}`}
          width={180}
          height={180}
          className="bg-white rounded-sm p-1 w-[11.25rem] h-[11.25rem]"
        />
      </div>
    </div>
  );
}

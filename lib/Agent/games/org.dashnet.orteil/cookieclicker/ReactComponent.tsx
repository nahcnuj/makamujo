import type { State } from "./State";

const formatNumber = new Intl.NumberFormat("ja-JP").format;

export default function ({ state }: { state: State }) {
  const generation = state.statistics?.general["遺産の始まり："]?.ascensions;
  const clickCount = state.statistics?.general["クリック回数："]?.value;

  return (
    <>
      <div>
        {generation !== undefined
          ? `${formatNumber(generation)}世代目`
          : "—世代目"}
      </div>
      <div>
        {clickCount !== undefined
          ? `クリック ${formatNumber(clickCount)}回`
          : "クリック —回"}
      </div>
    </>
  );
}

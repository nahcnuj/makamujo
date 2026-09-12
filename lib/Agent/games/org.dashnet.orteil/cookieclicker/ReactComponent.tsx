import type { State } from "./State";
import { enrichSightState } from "./server";

const formatNumber = new Intl.NumberFormat("ja-JP").format;

export default function ({ state: rawState }: { state: State }) {
  const state = enrichSightState(rawState);
  const generation = state.statistics?.general?.["遺産の始まり："]?.ascensions;
  const clickCount = state.statistics?.general?.["クリック回数："]?.value;

  if (generation === undefined || clickCount === undefined) {
    return null;
  }

  return (
    <>
      <div>{`${formatNumber(generation)}世代目`}</div>
      <div>{`クリック ${formatNumber(clickCount)}回`}</div>
    </>
  );
}

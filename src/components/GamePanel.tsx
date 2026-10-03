import type { FC } from "hono/jsx/dom";
import { Games } from "../../lib/Agent/games";
import { isRecord } from "../../lib/domain/json";
import { HighlightOnChange } from "../agt-compat";
import { useAgentContext } from "../contexts/AgentContext";
import { DeliveryVoltage } from "./DeliveryVoltage";

const _formatDuration = (d: Date) =>
  `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
// // Not implemented on an OBS browser...
// new Intl.DurationFormat('ja-JP', {
//   style: 'digital',
//   seconds: '2-digit',
//   minutes: '2-digit',
//   hours: '2-digit',
//   timeZone: 'Asia/Tokyo',
// }).format({
//   seconds: d.getSeconds(),
//   minutes: d.getMinutes(),
//   hours: d.getHours(),
// });

const formatNumber = new Intl.NumberFormat("ja-JP").format;

/**
 * `Games[name].Component` is a union of per-game components, so handing it JSX
 * would demand props satisfying *every* member (an intersection of the games'
 * state shapes). The payload really is whichever game `playing.name` selects,
 * and that pairing is a runtime fact, so the component is narrowed to one that
 * accepts the union of state shapes. Each game's own `Component` remains what
 * validates the payload.
 */
type SelectedGameState = Parameters<
  (typeof Games)[keyof typeof Games]["Component"]
>[0]["state"];

/** Return type Hono's JSX accepts for a function component. */
type HonoReturn = ReturnType<FC<Record<string, never>>>;

type SelectedGameComponent = (props: {
  state: SelectedGameState;
}) => HonoReturn;

/**
 * `Games[name].Component` and `playing.state` are unions whose members are not
 * mutually assignable, but the pairing is a runtime fact established by
 * `playing.name`. These guards carry that fact across the boundary instead of
 * asserting past it.
 */
const isSelectedGameComponent = (
  component: unknown,
): component is SelectedGameComponent => typeof component === "function";

const isSelectedGameState = (state: unknown): state is SelectedGameState =>
  isRecord(state);

export function GamePanel() {
  const { playing, streamState, commentCount, previousStreamCommentCount } =
    useAgentContext();

  // console.log(playing);
  const selectedComponent = playing ? Games[playing.name].Component : undefined;
  const Component: SelectedGameComponent = isSelectedGameComponent(
    selectedComponent,
  )
    ? selectedComponent
    : () => null;

  return (
    <div className="h-full flex flex-col justify-between text-2xl/8">
      <div className="flex-none">
        {playing && isSelectedGameState(playing.state) && (
          <Component state={playing.state} />
        )}
      </div>
      <div className="flex-none">
        <DeliveryVoltage
          commentCount={commentCount ?? 0}
          previousStreamCommentCount={previousStreamCommentCount ?? 0}
        />
        {streamState?.meta?.total && (
          <div className="text-right">
            <div>
              {streamState.meta.total.gift > 0 && (
                <HighlightOnChange
                  timeout={30_000}
                  classNameOnChanged="text-yellow-300"
                >
                  {`${formatNumber(streamState.meta.total.gift)}🎁`}
                </HighlightOnChange>
              )}
              {streamState.meta.total.listeners > 0 && (
                <HighlightOnChange
                  timeout={5_000}
                  classNameOnChanged="text-yellow-300"
                >
                  {`${formatNumber(streamState.meta.total.listeners)}🙎`}
                </HighlightOnChange>
              )}
            </div>
            {streamState.meta.total.ad > 0 && (
              <div>
                <HighlightOnChange
                  timeout={60_000}
                  classNameOnChanged="text-yellow-300"
                >
                  {`${formatNumber(streamState.meta.total.ad)}📣`}
                </HighlightOnChange>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { Games } from "../../lib/Agent/games";
import { useAgentContext } from "../contexts/AgentContext";
import { HighlightOnChange } from "./HighlightOnChange";

const formatDuration = (d: Date) =>
  `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
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

const formatNumber = new Intl.NumberFormat('ja-JP').format;

export function GamePanel() {
  const { gameState, streamState } = useAgentContext();

  const now = new Date();
  const duration = new Date(now.getTime() - (streamState?.start ?? 0) + now.getTimezoneOffset() * 60_000);

  const Component = gameState ? Games[(gameState as any).name as 'CookieClicker'].Component : () => null;

  return (
    <div className="h-full flex flex-col justify-between text-2xl/8">
      <div className="flex-none">
        <Component />
      </div>
      <div className="flex-none">
        {streamState?.total && (
          <div className="text-right">
            {streamState.total.listeners > 0 && (
              <div>
                <HighlightOnChange timeout={5_000} classNameOnChanged="text-yellow-300">
                  {`${formatNumber(streamState.total.listeners)}🙎`}
                </HighlightOnChange>
              </div>
            )}
            {streamState.total.ad > 0 && (
              <div>
                <HighlightOnChange timeout={60_000} classNameOnChanged="text-yellow-300">
                  {`${formatNumber(streamState.total.ad)}📣`}
                </HighlightOnChange>
              </div>
            )}
            {streamState.total.gift > 0 && (
              <div>
                <HighlightOnChange timeout={30_000} classNameOnChanged="text-yellow-300">
                  {`${formatNumber(streamState.total.gift)}🎁`}
                </HighlightOnChange>
              </div>
            )}
            {streamState.start && (
              <div>
                {`${formatDuration(duration)}⏱️`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** @jsxImportSource hono/jsx/dom */
import type { State } from "./State";

export default function ({ state }: { state: State }) {
  console.log('CookieClickerComponent', state);
  const { cookies } = state;

  return (
    <>
      <div>
        {`🍪${cookies.toExponential(2)}枚`}
      </div>
    </>
  );
}

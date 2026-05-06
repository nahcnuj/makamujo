import { useEffect, useRef } from "hono/jsx/dom";

/**
 * Repeatedly invokes an async callback at the given interval (in milliseconds).
 * The next invocation is scheduled only after the previous one settles.
 *
 * This is a hono/jsx/dom-native re-implementation of the same hook from
 * automated-gameplay-transmitter. The AGT package's compiled dist file
 * imports `useRef`/`useEffect` from `react`, which Bun.build does not
 * reliably redirect via its `alias` option for pre-compiled packages.
 * Using this local version avoids bundling actual React alongside
 * hono/jsx/dom and prevents the "Cannot read properties of null (reading
 * 'useRef')" runtime error in OBS Browser.
 */
export const useInterval = (ms: number, f: () => Promise<void>): void => {
  const ref = useRef<() => Promise<void>>(f);
  useEffect(() => {
    ref.current = f;
  }, [f]);
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    let cancelled = false;
    function run() {
      ref.current?.().catch(console.error).finally(() => {
        if (cancelled) {
          return;
        }
        id = setTimeout(run, ms);
      });
    }
    id = setTimeout(run, ms);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [ms]);
};

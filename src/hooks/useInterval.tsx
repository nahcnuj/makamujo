import { useEffect } from "react";

/**
 * Starts a repeating timer that invokes an asynchronous callback at a fixed interval.
 *
 * The hook creates a single setInterval (on mount) and clears it on unmount.
 * If a tick occurs while the previous invocation is still pending, the tick is skipped to avoid overlapping executions.
 * But it does not queue missed ticks.
 *
 * @param ms - Interval delay in milliseconds.
 * @param f - Async callback to execute on each tick. Should return Promise<void>.
 *
 * @remarks
 * - The effect uses an empty dependency array, so the hook captures the initial references to `ms`
 *   and `f`. If you need the interval to react to changes in `ms` or `f`, either wrap `f` in
 *   `useCallback` and include dependencies, or store the latest values in refs and read them inside
 *   the interval callback.
 * - Errors thrown or rejected promises from `f` are not caught by the hook; handle errors inside
 *   `f` to avoid unhandled promise rejections.
 * - This hook requires React's useEffect to be in scope (i.e., used inside a React component or another hook).
 *
 * @example
 * useInterval(1000, async () => {
 *   await fetchLatestData();
 * });
 */
export const useInterval = (ms: number, f: () => Promise<void>) => {
  useEffect(() => {
    let running = false;
    const id = setInterval(async () => {
      if (running) {
        console.warn('This interval is skipped.');
        return;
      }
      running = true;
      await f();
      running = false;
    }, ms);

    return () => clearInterval(id);
  }, []);
};
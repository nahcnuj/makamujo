/**
 * Starts periodic refresh polling and returns a cleanup function.
 * `refreshIntervalMs` is overrideable for tests.
 */
export const useAgentStateAutoRefresh = (
  fetchAgentState: () => Promise<void>,
  refreshIntervalMs = 1000,
) => {
  let isFetching = false;
  const intervalId = setInterval(() => {
    if (isFetching) {
      return;
    }

    isFetching = true;
    void fetchAgentState()
      .catch(() => undefined)
      .finally(() => {
        isFetching = false;
      });
  }, refreshIntervalMs);
  return () => {
    clearInterval(intervalId);
  };
};

import { afterEach, describe, expect, it, mock } from "bun:test";
import { useAgentStateAutoRefresh } from "./hooks";
import { AGENT_STATE_REFRESH_INTERVAL_MS } from "./Component";

const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;

afterEach(() => {
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
});

describe("useAgentStateAutoRefresh (unit)", () => {
  it("registers periodic refresh and clears interval on cleanup", async () => {
    const fetchAgentState = mock(async () => {});
    const intervalToken = { token: "interval" } as unknown as ReturnType<typeof setInterval>;
    let registeredCallback: TimerHandler | null = null;

    globalThis.setInterval = mock((handler: TimerHandler, timeout?: number) => {
      if (typeof handler === "function") {
        registeredCallback = handler;
      }
      expect(timeout).toBe(AGENT_STATE_REFRESH_INTERVAL_MS);
      return intervalToken;
    }) as unknown as typeof setInterval;

    const clearIntervalMock = mock((_: ReturnType<typeof setInterval>) => {});
    globalThis.clearInterval = clearIntervalMock as unknown as typeof clearInterval;

    const stopAutoRefresh = useAgentStateAutoRefresh(fetchAgentState);

    expect(globalThis.setInterval).toHaveBeenCalledTimes(1);
    expect(registeredCallback).not.toBeNull();
    if (typeof registeredCallback === "function") {
      (registeredCallback as () => void)();
    }
    await Promise.resolve();
    expect(fetchAgentState).toHaveBeenCalledTimes(1);

    stopAutoRefresh();
    expect(clearIntervalMock).toHaveBeenCalledWith(intervalToken);
  });

  it("swallows polling callback rejection", async () => {
    const fetchAgentState = mock(async () => {
      throw new Error("temporary failure");
    });
    let registeredCallback: TimerHandler | null = null;

    globalThis.setInterval = mock((handler: TimerHandler) => {
      if (typeof handler === "function") {
        registeredCallback = handler;
      }
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;

    useAgentStateAutoRefresh(fetchAgentState, 100);
    expect(typeof registeredCallback).toBe("function");
    if (typeof registeredCallback === "function") {
      const invokeRegisteredCallback = registeredCallback as () => void;
      expect(() => invokeRegisteredCallback()).not.toThrow();
    }
    await Promise.resolve();
    expect(fetchAgentState).toHaveBeenCalledTimes(1);
  });

  it("does not start a new refresh while previous refresh is still in-flight", async () => {
    let registeredCallback: TimerHandler | null = null;
    let resolveFetch: () => void = () => {};
    const fetchAgentState = mock(
      () =>
        new Promise<void>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    globalThis.setInterval = mock((handler: TimerHandler) => {
      if (typeof handler === "function") {
        registeredCallback = handler;
      }
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;

    useAgentStateAutoRefresh(fetchAgentState, 100);
    expect(typeof registeredCallback).toBe("function");
    if (typeof registeredCallback !== "function") {
      throw new Error("registered callback is not a function");
    }
    const invokeRegisteredCallback = registeredCallback as () => void;

    invokeRegisteredCallback();
    invokeRegisteredCallback();
    expect(fetchAgentState).toHaveBeenCalledTimes(1);

    resolveFetch();
    await Promise.resolve();
    await Promise.resolve();

    invokeRegisteredCallback();
    expect(fetchAgentState).toHaveBeenCalledTimes(2);
  });
});

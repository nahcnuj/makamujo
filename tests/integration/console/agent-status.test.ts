import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  AGENT_STATE_REFRESH_INTERVAL_MS,
  createMockAgentStateResponse,
  createAgentStatusRows,
  startAgentStateAutoRefresh,
} from "../../../console/src/AgentStatus";

const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;

afterEach(() => {
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
});

describe("startAgentStateAutoRefresh", () => {
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

    const stopAutoRefresh = startAgentStateAutoRefresh(fetchAgentState);

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
      return { token: "interval" } as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;

    startAgentStateAutoRefresh(fetchAgentState, 100);
    expect(typeof registeredCallback).toBe("function");
    if (typeof registeredCallback === "function") {
      const invokeRegisteredCallback = registeredCallback as () => void;
      expect(() => invokeRegisteredCallback()).not.toThrow();
    }
    await Promise.resolve();
    expect(fetchAgentState).toHaveBeenCalledTimes(1);
  });
});

describe("createAgentStatusRows", () => {
  it("returns readable status rows when niconama metadata exists", () => {
    const rows = createAgentStatusRows({
      niconama: {
        type: "live",
        meta: {
          title: "テスト配信",
          url: "https://example.com/live",
          start: 1_717_000_000,
          total: {
            listeners: 123,
            gift: 456,
            ad: 789,
          },
        },
      },
    });

    expect(rows).toContainEqual({ label: "状態", value: "配信中" });
    expect(rows).toContainEqual({ label: "タイトル", value: "テスト配信" });
    expect(rows).toContainEqual({
      label: "配信URL",
      value: "https://example.com/live",
      href: "https://example.com/live",
    });
    expect(rows).toContainEqual({ label: "視聴者数", value: "123" });
    expect(rows).toContainEqual({ label: "ギフト", value: "456" });
    expect(rows).toContainEqual({ label: "広告", value: "789" });
  });

  it("returns empty rows when niconama state is absent", () => {
    expect(createAgentStatusRows({})).toEqual([]);
    expect(createAgentStatusRows(null)).toEqual([]);
  });

  it("returns fallback rows when niconama exists without metadata", () => {
    const rows = createAgentStatusRows({ niconama: { type: "live" } });
    expect(rows).toContainEqual({ label: "状態", value: "配信中" });
    expect(rows).toContainEqual({ label: "タイトル", value: "-" });
    expect(rows).toContainEqual({ label: "配信URL", value: "-", href: undefined });
  });
});

describe("createMockAgentStateResponse", () => {
  it("returns deterministic mock state for screenshot capture", () => {
    expect(createMockAgentStateResponse()).toEqual({
      niconama: {
        type: "live",
        meta: {
          title: "配信エージェント状態モック",
          url: "https://example.com/watch/mock",
          start: 1_717_000_000,
          total: {
            listeners: 123,
            gift: 456,
            ad: 789,
          },
        },
      },
    });
  });
});

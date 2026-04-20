import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  AGENT_STATE_REFRESH_INTERVAL_MS,
  createMockAgentStateResponse,
  createAgentStatusSections,
  createAgentStatusRows,
  isAgentStateMockQueryEnabled,
  parseAgentStateResponse,
  shouldUseMockAgentState,
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
      return 1 as unknown as ReturnType<typeof setInterval>;
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

    startAgentStateAutoRefresh(fetchAgentState, 100);
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

  it("includes canSpeak, currentGame and speech rows when present", () => {
    const rows = createAgentStatusRows({
      canSpeak: true,
      currentGame: { name: "org.dashnet.orteil/cookieclicker", state: { status: "idle" } },
      nGram: 4,
      speech: { speech: "テスト発話", silent: false },
    });

    expect(rows).toContainEqual({ label: "話せる状態", value: "はい" });
    expect(rows).toContainEqual({ label: "現在のゲーム", value: "org.dashnet.orteil/cookieclicker" });
    expect(rows).toContainEqual({
      label: "ソルバーに渡す状態",
      value: "{\n  \"status\": \"idle\"\n}",
      preformatted: true,
    });
    expect(rows).toContainEqual({ label: "生成N-gram", value: "4-gram" });
    expect(rows).toContainEqual({ label: "発話内容", value: "テスト発話" });
  });

  it("shows currentGame as '-' when null", () => {
    const rows = createAgentStatusRows({ currentGame: null });
    expect(rows).toContainEqual({ label: "現在のゲーム", value: "-" });
    expect(rows).toContainEqual({ label: "ソルバーに渡す状態", value: "-", preformatted: true });
  });

  it("shows canSpeak as 'いいえ' when false", () => {
    const rows = createAgentStatusRows({ canSpeak: false });
    expect(rows).toContainEqual({ label: "話せる状態", value: "いいえ" });
  });

  it("formats n-gram row with fallback for invalid numbers", () => {
    expect(createAgentStatusRows({ nGram: Infinity })).toContainEqual({ label: "生成N-gram", value: "-" });
    expect(createAgentStatusRows({ nGram: 0 })).toContainEqual({ label: "生成N-gram", value: "-" });
    expect(createAgentStatusRows({ nGram: 4.8 })).toContainEqual({ label: "生成N-gram", value: "4-gram" });
    expect(createAgentStatusRows({})).not.toContainEqual({ label: "生成N-gram", value: "-" });
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

  it("formats niconama start time from millisecond timestamps without multiplying again", () => {
    const rows = createAgentStatusRows({
      niconama: {
        type: "live",
        meta: {
          start: 1_713_533_637_000,
        },
      },
    });
    const startRow = rows.find((row) => row.label === "開始時刻");
    expect(startRow?.value).toContain("2024");
  });
});

describe("createAgentStatusSections", () => {
  it("categorizes rows into delivery, markov-model, and game sections", () => {
    const sections = createAgentStatusSections(createMockAgentStateResponse());

    expect(sections).toEqual([
      {
        title: "配信状況",
        rows: [
          { label: "状態", value: "配信中" },
          { label: "タイトル", value: "配信エージェント状態モック" },
          {
            label: "配信URL",
            value: "https://example.com/watch/mock",
            href: "https://example.com/watch/mock",
          },
          { label: "開始時刻", value: new Date(1_717_000_000_000).toLocaleString("ja-JP") },
          { label: "視聴者数", value: "123" },
          { label: "ギフト", value: "456" },
          { label: "広告", value: "789" },
        ],
      },
      {
        title: "マルコフ連鎖モデルの状態",
        rows: [
          { label: "話せる状態", value: "はい" },
          { label: "生成N-gram", value: "4-gram" },
          { label: "発話内容", value: "コメントを学習してお話ししています" },
        ],
      },
      {
        title: "ゲームの状態",
        rows: [
          { label: "現在のゲーム", value: "org.dashnet.orteil/cookieclicker" },
          { label: "ソルバーに渡す状態", value: "{\n  \"status\": \"idle\"\n}", preformatted: true },
        ],
      },
    ]);
  });

  it("returns only sections that have rows", () => {
    const sections = createAgentStatusSections({ nGram: 4 });
    expect(sections).toEqual([
      {
        title: "マルコフ連鎖モデルの状態",
        rows: [{ label: "生成N-gram", value: "4-gram" }],
      },
    ]);
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
      canSpeak: true,
      currentGame: {
        name: "org.dashnet.orteil/cookieclicker",
        state: {
          status: "idle",
        },
      },
      nGram: 4,
      speech: {
        speech: "コメントを学習してお話ししています",
        silent: false,
      },
    });
  });
});

describe("isAgentStateMockQueryEnabled", () => {
  it("returns true when the query includes agentStateMock=1", () => {
    expect(isAgentStateMockQueryEnabled("?agentStateMock=1")).toBe(true);
  });

  it("returns false when the query omits or changes the flag value", () => {
    expect(isAgentStateMockQueryEnabled("")).toBe(false);
    expect(isAgentStateMockQueryEnabled("?agentStateMock=0")).toBe(false);
  });
});

describe("shouldUseMockAgentState", () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

  afterEach(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
      return;
    }
    // @ts-expect-error test cleanup for Node-like runtime
    delete globalThis.window;
  });

  it("returns false when window is unavailable", () => {
    // @ts-expect-error test setup for Node-like runtime
    delete globalThis.window;
    expect(shouldUseMockAgentState()).toBe(false);
  });

  it("returns true when browser query enables mock mode", () => {
    Object.defineProperty(globalThis, "window", {
      value: { location: { search: "?agentStateMock=1" } },
      configurable: true,
    });
    expect(shouldUseMockAgentState()).toBe(true);
  });
});

describe("parseAgentStateResponse", () => {
  it("parses valid JSON payload", () => {
    expect(parseAgentStateResponse("{\"niconama\":{\"type\":\"live\"}}")).toEqual({
      niconama: { type: "live" },
    });
  });

  it("throws user-facing syntax error for invalid JSON payload", () => {
    expect(() => parseAgentStateResponse("<!doctype html>")).toThrow(
      "配信状態の応答形式が不正です。",
    );
  });
});

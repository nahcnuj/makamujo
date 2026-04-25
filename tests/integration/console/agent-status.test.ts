import { afterEach, describe, expect, it, mock } from "bun:test";
import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AGENT_STATE_REFRESH_INTERVAL_MS,
  createAgentStatusSections,
  createAgentStatusRows,
  startAgentStateAutoRefresh,
} from "../../../console/src/AgentStatus";
import { parseAgentStateResponse } from "../../../console/src/hooks/useAgentState";
import { cloneAgentStateResponseMockFixture } from "../../fixtures/agentStateResponseMock";

const createMockAgentStateResponse = () => cloneAgentStateResponseMockFixture();
const AGENT_STATE_MOCK_QUERY_KEY = "agentStateMock";
const isAgentStateMockQueryEnabled = (searchParams: string): boolean => {
  return new URLSearchParams(searchParams).get(AGENT_STATE_MOCK_QUERY_KEY) === "1";
};
const shouldUseMockAgentState = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  return isAgentStateMockQueryEnabled(window.location.search);
};

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

    const liveMetricRow = rows.find((row) => row.label === "配信指標");
    expect(liveMetricRow?.value).toBeUndefined();
    expect(liveMetricRow?.hideLabel).toBeTrue();
    const liveMetricHtml = renderToStaticMarkup(createElement(Fragment, null, liveMetricRow?.valueComponent));
    expect(liveMetricHtml).toContain("状態");
    expect(liveMetricHtml).toContain("配信中");
    expect(liveMetricHtml).toContain("視聴者数");
    expect(liveMetricHtml).toContain("123");
    expect(liveMetricHtml).toContain("コメント数");
    expect(liveMetricHtml).toContain("grid-cols-5");
    expect(rows).toContainEqual({ label: "タイトル", value: "テスト配信" });
    expect(rows).toContainEqual({
      label: "配信URL",
      value: "https://example.com/live",
      href: "https://example.com/live",
    });
  });

  it("includes currentGame and speech rows when present", () => {
    const rows = createAgentStatusRows({
      canSpeak: true,
      currentGame: { name: "org.dashnet.orteil/cookieclicker", state: { status: "idle" } },
      nGram: 4,
      nGramRaw: 4,
      speechHistory: [
        { id: "history-1", speech: "テスト発話その1", nGram: 4, nGramRaw: 4 },
        { id: "history-2", speech: "テスト発話その2", nGram: 3, nGramRaw: 3.2 },
      ],
      speech: { speech: "テスト発話", silent: false },
    });

    expect(rows).toContainEqual({ label: "現在のゲーム", value: "org.dashnet.orteil/cookieclicker" });
    expect(rows).toContainEqual({ label: "生成N-gram", value: "4-gram (4.00)" });
    const gameInfoRow = rows.find((row) => row.label === "ゲーム情報");
    expect(gameInfoRow?.value).toBeUndefined();
    expect(gameInfoRow?.valueComponent).toBeDefined();
    const gameInfoHtml = renderToStaticMarkup(createElement(Fragment, null, gameInfoRow?.valueComponent));
    expect(gameInfoHtml).toContain("<ul");
    expect(gameInfoHtml).toContain("status");
    expect(gameInfoHtml).toContain("idle");
    const speechHistoryRow = rows.find((row) => row.label === "これまでの発話");
    expect(speechHistoryRow?.value).toBeUndefined();
    const speechHistoryHtml = renderToStaticMarkup(createElement(Fragment, null, speechHistoryRow?.valueComponent));
    expect(speechHistoryHtml).toContain("<ul");
    expect(speechHistoryHtml).toContain("grid-cols-1");
    expect(speechHistoryHtml).toContain("テスト発話その1");
    expect(speechHistoryHtml).toContain("テスト発話その2");
    expect(speechHistoryHtml).toContain("4g");
    expect(speechHistoryHtml).toContain("3g");
    expect(speechHistoryHtml).toContain("aria-label=\"学習の取り消し\"");
    expect(rows).toContainEqual({ label: "発話内容", value: "テスト発話" });
  });

  it("formats currentGame.state as structured, human-friendly lines", () => {
    const rows = createAgentStatusRows({
      currentGame: {
        name: "game",
        state: {
          stage: {
            level: 3,
          },
          effects: ["boost", "shield"],
        },
      },
    });

    const gameInfoRow = rows.find((row) => row.label === "ゲーム情報");
    expect(gameInfoRow?.value).toBeUndefined();
    const gameInfoHtml = renderToStaticMarkup(createElement(Fragment, null, gameInfoRow?.valueComponent));
    expect(gameInfoHtml).toContain("<ul");
    expect(gameInfoHtml).toContain("stage");
    expect(gameInfoHtml).toContain("effects");
    expect(gameInfoHtml).toContain("boost");
    expect(gameInfoHtml).toContain("shield");
  });

  it("formats nested objects and empty collections in structured display", () => {
    const rows = createAgentStatusRows({
      currentGame: {
        name: "game",
        state: {
          profile: {
            stats: {},
            inventory: [],
          },
        },
      },
    });

    const gameInfoRow = rows.find((row) => row.label === "ゲーム情報");
    expect(gameInfoRow?.value).toBeUndefined();
    const gameInfoHtml = renderToStaticMarkup(createElement(Fragment, null, gameInfoRow?.valueComponent));
    expect(gameInfoHtml).toContain("空のオブジェクト");
    expect(gameInfoHtml).toContain("空の配列");
  });

  it("shows currentGame as '-' when null", () => {
    const rows = createAgentStatusRows({ currentGame: null });
    expect(rows).toContainEqual({ label: "現在のゲーム", value: "-" });
    const gameInfoRow = rows.find((row) => row.label === "ゲーム情報");
    expect(gameInfoRow?.value).toBeUndefined();
    expect(renderToStaticMarkup(createElement(Fragment, null, gameInfoRow?.valueComponent))).toContain("-");
  });

  it("falls back solver state row to '-' when currentGame.state is not serializable", () => {
    const circularState: Record<string, unknown> = {};
    circularState.self = circularState;
    const rows = createAgentStatusRows({
      currentGame: {
        name: "org.dashnet.orteil/cookieclicker",
        state: circularState,
      },
    });
    const gameInfoRow = rows.find((row) => row.label === "ゲーム情報");
    expect(gameInfoRow?.value).toBeUndefined();
    expect(renderToStaticMarkup(createElement(Fragment, null, gameInfoRow?.valueComponent))).toContain("-");
  });

  it("shows speech as '・・・' when canSpeak is false", () => {
    const rows = createAgentStatusRows({ canSpeak: false });
    expect(rows).toContainEqual({ label: "発話内容", value: "・・・" });
    expect(rows).not.toContainEqual({ label: "話せる状態", value: "いいえ" });
  });

  it("prioritizes speech unavailable indicator when canSpeak is false even if speech exists", () => {
    const rows = createAgentStatusRows({ canSpeak: false, speech: { speech: "発話テキスト", silent: false } });
    expect(rows).toContainEqual({ label: "発話内容", value: "・・・" });
    expect(rows).not.toContainEqual({ label: "発話内容", value: "発話テキスト" });
  });

  it("formats n-gram row with fallback for invalid numbers", () => {
    expect(createAgentStatusRows({ nGram: Infinity })).toContainEqual({ label: "生成N-gram", value: "-" });
    expect(createAgentStatusRows({ nGram: 0 })).toContainEqual({ label: "生成N-gram", value: "-" });
    expect(createAgentStatusRows({ nGram: 4.8 })).toContainEqual({ label: "生成N-gram", value: "4-gram" });
    expect(createAgentStatusRows({ nGram: 4.8, nGramRaw: 4.8 })).toContainEqual({ label: "生成N-gram", value: "4-gram (4.80)" });
    expect(createAgentStatusRows({ nGram: 4.8, nGramRaw: 0.5 })).toContainEqual({ label: "生成N-gram", value: "4-gram" });
    expect(createAgentStatusRows({ nGram: 4.8, nGramRaw: -2 })).toContainEqual({ label: "生成N-gram", value: "4-gram" });
    expect(createAgentStatusRows({})).not.toContainEqual({ label: "生成N-gram", value: "-" });
  });

  it("shows all speech history items in descending order", () => {
    const speechHistory = Array.from({ length: 12 }, (_, index) => ({
      id: `history-${index + 1}`,
      speech: `テスト発話${index + 1}`,
      nGram: 4,
      nGramRaw: 4,
    }));
    const rows = createAgentStatusRows({ speechHistory });
    const speechHistoryRow = rows.find((row) => row.label === "これまでの発話");
    expect(speechHistoryRow?.value).toBeUndefined();
    const speechHistoryHtml = renderToStaticMarkup(createElement(Fragment, null, speechHistoryRow?.valueComponent));
    expect(speechHistoryHtml).toContain(">テスト発話1<");
    expect(speechHistoryHtml).toContain(">テスト発話12<");
    expect((speechHistoryHtml.match(/aria-label="学習の取り消し"/g) ?? []).length).toBe(12);
    const speechIndicesDescending = Array.from({ length: 12 }, (_, index) => {
      const speechNumber = 12 - index;
      return speechHistoryHtml.indexOf(`>テスト発話${speechNumber}<`);
    });
    expect(speechIndicesDescending.every((speechIndex) => speechIndex >= 0)).toBe(true);
    speechIndicesDescending.slice(1).forEach((currentSpeechIndex, index) => {
      const previousSpeechIndex = speechIndicesDescending[index] as number;
      expect(previousSpeechIndex).toBeLessThan(currentSpeechIndex);
    });
  });

  it("returns empty rows when niconama state is absent", () => {
    expect(createAgentStatusRows({})).toEqual([]);
    expect(createAgentStatusRows(null)).toEqual([]);
  });

  it("returns fallback rows when niconama exists without metadata", () => {
    const rows = createAgentStatusRows({ niconama: { type: "live" } });
    const liveMetricRow = rows.find((row) => row.label === "配信指標");
    expect(liveMetricRow?.value).toBeUndefined();
    expect(renderToStaticMarkup(createElement(Fragment, null, liveMetricRow?.valueComponent))).toContain("配信中");
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

    expect(sections).toHaveLength(3);
    const liveDeliverySection = sections.find((section) => section.title === "配信状況");
    expect(liveDeliverySection?.rows).toContainEqual({
      label: "配信指標",
      hideLabel: true,
      valueComponent: expect.anything(),
    });
    expect(liveDeliverySection?.rows).toContainEqual({ label: "発話内容", value: "コメントを学習してお話ししています" });
    const markovModelSection = sections.find((section) => section.title === "マルコフ連鎖モデルの状態");
    expect(markovModelSection?.rows).toContainEqual({ label: "生成N-gram", value: "4-gram (4.00)" });
    expect(markovModelSection?.rows).not.toContainEqual({ label: "発話内容", value: "コメントを学習してお話ししています" });
    const gameSection = sections.find((section) => section.title === "ゲームの状態");
    expect(gameSection?.rows).toContainEqual({ label: "現在のゲーム", value: "org.dashnet.orteil/cookieclicker" });
    const gameInfoRow = gameSection?.rows.find((row) => row.label === "ゲーム情報");
    expect(gameInfoRow?.value).toBeUndefined();
    expect(renderToStaticMarkup(createElement(Fragment, null, gameInfoRow?.valueComponent))).toContain("status");
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

  it("includes speech history row in markov model section", () => {
    const sections = createAgentStatusSections({
      speechHistory: [{ speech: "過去発話", nGram: 4, nGramRaw: 4 }],
    });
    expect(sections).toEqual([
      {
        title: "マルコフ連鎖モデルの状態",
        rows: [{
          label: "これまでの発話",
          valueComponent: expect.anything(),
        }],
      },
    ]);
  });

  it("includes current speech row in live delivery section", () => {
    const sections = createAgentStatusSections({
      niconama: { type: "live" },
      speech: { speech: "最新発話", silent: false },
    });
    const liveDeliverySection = sections.find((section) => section.title === "配信状況");
    expect(liveDeliverySection?.rows).toContainEqual({ label: "発話内容", value: "最新発話" });
    const markovModelSection = sections.find((section) => section.title === "マルコフ連鎖モデルの状態");
    expect(markovModelSection).toBeUndefined();
  });
});

describe("createMockAgentStateResponse", () => {
  it("returns deterministic mock state for screenshot capture", () => {
    expect(createMockAgentStateResponse()).toEqual(cloneAgentStateResponseMockFixture());
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

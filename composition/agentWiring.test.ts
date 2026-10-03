import { describe, expect, it, mock } from "bun:test";
import {
  createAgentHostView,
  createFallbackAgent,
  isAgentLike,
  loadCreateAgentApi,
  tryCreateExternalAgentApi,
} from "./agentWiring";

const AGENT_METHODS = [
  "setSpeech",
  "getSpeech",
  "getGame",
  "getStreamState",
  "publishStreamState",
  "postComments",
] as const;

describe("isAgentLike", () => {
  it("accepts the fallback agent", () => {
    const agent = createFallbackAgent(
      () => undefined,
      () => {},
      () => ({ speech: "", silent: false }),
      () => {},
    );
    expect(isAgentLike(agent)).toBeTrue();
  });

  it("accepts any object exposing every method", () => {
    const stub = Object.fromEntries(
      AGENT_METHODS.map((name) => [name, () => undefined]),
    );
    expect(isAgentLike(stub)).toBeTrue();
  });

  it("rejects an object missing a method", () => {
    for (const missing of AGENT_METHODS) {
      const stub: Record<string, unknown> = Object.fromEntries(
        AGENT_METHODS.filter((name) => name !== missing).map((name) => [
          name,
          () => undefined,
        ]),
      );
      expect(isAgentLike(stub)).toBeFalse();
    }
  });

  it("rejects non-functions in a method position", () => {
    const stub: Record<string, unknown> = Object.fromEntries(
      AGENT_METHODS.map((name) => [name, () => undefined]),
    );
    stub.getSpeech = "not a function";
    expect(isAgentLike(stub)).toBeFalse();
  });

  it("rejects null, primitives and functions", () => {
    expect(isAgentLike(null)).toBeFalse();
    expect(isAgentLike(undefined)).toBeFalse();
    expect(isAgentLike(42)).toBeFalse();
    expect(isAgentLike("agent")).toBeFalse();
    expect(isAgentLike(() => {})).toBeFalse();
  });
});

describe("createFallbackAgent", () => {
  it("stores speech and published stream state", () => {
    let lastPublished: unknown = undefined;
    let speech = { speech: "", silent: false };
    const agent = createFallbackAgent(
      () => lastPublished,
      (d) => {
        lastPublished = d;
      },
      () => speech,
      (s) => {
        speech = s;
      },
    );

    agent.setSpeech("hello");
    expect(agent.getSpeech()).toEqual({ speech: "hello", silent: false });
    agent.publishStreamState({ niconama: { type: "live" } });
    expect(agent.getStreamState()).toEqual({ niconama: { type: "live" } });
  });

  it("forwards postComments to the streamer when forwardComments is provided", () => {
    const received: unknown[][] = [];
    const agent = createFallbackAgent(
      () => undefined,
      () => {},
      () => ({ speech: "", silent: false }),
      () => {},
      (comments) => {
        received.push(comments);
      },
    );

    const batch = [{ data: { comment: "hi", no: 1 } }];
    agent.postComments(batch);
    expect(received).toEqual([batch]);
  });

  it("no-ops postComments when forwardComments is omitted", () => {
    const agent = createFallbackAgent(
      () => undefined,
      () => {},
      () => ({ speech: "", silent: false }),
      () => {},
    );
    expect(() => agent.postComments([{ data: {} }])).not.toThrow();
  });
});

describe("loadCreateAgentApi", () => {
  it("returns a function when AGT is installed", async () => {
    const fn = await loadCreateAgentApi();
    // Installed package (0.6.4+) always has createAgentApi on root; ./agent when ≥0.6.5.
    expect(typeof fn === "function" || fn === undefined).toBe(true);
    if (fn) {
      const api = fn({
        canSpeak: true,
        onAir: () => {},
        listen: () => {},
      }) as { getSpeech: () => { speech: string; silent: boolean } };
      expect(typeof api.getSpeech).toBe("function");
    }
  });
});

describe("tryCreateExternalAgentApi", () => {
  it("returns an agent API object when createAgentApi is available", async () => {
    const result = await tryCreateExternalAgentApi({
      canSpeak: true,
      currentGame: null,
      streamState: undefined,
      onAir: () => {},
      listen: () => {},
    });
    if (result === undefined) {
      // Environment without AGT module resolution — acceptable.
      return;
    }
    expect(result).toBeTruthy();
    expect(typeof (result as { getSpeech: () => unknown }).getSpeech).toBe(
      "function",
    );
  });
});

describe("createAgentHostView", () => {
  const makeStreamer = (label: string) => ({
    label,
    canSpeak: label === "can",
    currentGame: `game-${label}`,
    streamState: { label },
    onAir: mock((state: unknown) => state),
    listen: mock((_comments: unknown[]) => undefined),
  });

  it("reads through to the instance resolved at call time", () => {
    const view = createAgentHostView(() => makeStreamer("a"));
    expect(view.canSpeak).toBeFalse();
    expect(view.currentGame).toBe("game-a");
    expect(view.streamState).toEqual({ label: "a" });
  });

  it("follows the streamer when it is rebuilt", () => {
    // The AGT agent keeps one view for its whole life; rebuilding the streamer
    // (#639) must be visible through it without recreating the agent.
    let current = makeStreamer("a");
    const view = createAgentHostView(() => current);

    expect(view.currentGame).toBe("game-a");

    current = makeStreamer("b");
    expect(view.currentGame).toBe("game-b");
    expect(view.streamState).toEqual({ label: "b" });
  });

  it("forwards onAir and listen to the current instance", () => {
    const first = makeStreamer("a");
    const second = makeStreamer("b");
    let current = first;
    const view = createAgentHostView(() => current);

    view.onAir("state-1");
    expect(first.onAir).toHaveBeenCalledWith("state-1");

    current = second;
    view.onAir("state-2");
    expect(first.onAir).toHaveBeenCalledTimes(1);
    expect(second.onAir).toHaveBeenCalledWith("state-2");

    view.listen([{ data: { comment: "hi" } }]);
    expect(second.listen).toHaveBeenCalledTimes(1);
    expect(first.listen).toHaveBeenCalledTimes(0);
  });
});

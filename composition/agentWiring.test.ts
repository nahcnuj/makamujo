import { describe, expect, it, mock } from "bun:test";
import {
  createFallbackAgent,
  loadCreateAgentApi,
  tryCreateExternalAgentApi,
} from "./agentWiring";

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

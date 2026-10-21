import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { JSDOM } from "jsdom";
import { mount } from "../mount";
import {
  BroadcastLivenessSweep,
  LIVENESS_SWEEP_END_VH,
  LIVENESS_SWEEP_FROM_COLOR,
  LIVENESS_SWEEP_HEIGHT_VH,
  LIVENESS_SWEEP_ONE_WAY_SECONDS,
  LIVENESS_SWEEP_START_VH,
  LIVENESS_SWEEP_TO_COLOR,
  toLivenessSweepCssColor,
} from "./BroadcastLivenessSweep";

describe("BroadcastLivenessSweep", () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let animateMock: ReturnType<typeof mock>;

  beforeEach(() => {
    dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
      url: "http://localhost/",
      pretendToBeVisual: true,
    });

    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.Element = dom.window.Element;
    globalThis.Node = dom.window.Node;
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      return dom.window.setTimeout(
        () => cb(Date.now()),
        0,
      ) as unknown as number;
    };
    globalThis.cancelAnimationFrame = (id: number) => {
      dom.window.clearTimeout(id);
    };

    container = document.createElement("div");
    document.body.appendChild(container);

    animateMock = mock(() => ({
      cancel: mock(),
      play: mock(),
      pause: mock(),
      finished: Promise.resolve(),
    }));
    (dom.window.HTMLElement.prototype as HTMLElement).animate =
      animateMock as HTMLElement["animate"];
    globalThis.HTMLElement = dom.window.HTMLElement;
  });

  afterEach(() => {
    container.remove();
  });

  it("exports checker-safe geometry and colors", () => {
    // Band must span the full width and game clip (left 60%) — CSS does that.
    expect(LIVENESS_SWEEP_HEIGHT_VH).toBe(3);
    expect(LIVENESS_SWEEP_ONE_WAY_SECONDS).toBe(2);
    expect(LIVENESS_SWEEP_START_VH).toBe(-3);
    expect(LIVENESS_SWEEP_END_VH).toBe(103);
    // Opaque, high-contrast ramp background-independent.
    expect(LIVENESS_SWEEP_FROM_COLOR).toEqual({ r: 52, g: 211, b: 153 });
    expect(LIVENESS_SWEEP_TO_COLOR).toEqual({ r: 255, g: 190, b: 240 });
    expect(toLivenessSweepCssColor(LIVENESS_SWEEP_FROM_COLOR)).toBe(
      "rgb(52, 211, 153)",
    );
  });

  it("renders the sweep element and starts a looping alternate animation", async () => {
    const root = mount(<BroadcastLivenessSweep />, container);
    await new Promise((r) => setTimeout(r, 50));

    const element = document.querySelector(
      ".broadcast-liveness-sweep",
    ) as HTMLElement | null;
    expect(element).not.toBeNull();
    expect(element?.getAttribute("aria-hidden")).toBe("true");
    expect(element?.style.height).toBe(`${LIVENESS_SWEEP_HEIGHT_VH}vh`);

    expect(animateMock).toHaveBeenCalledTimes(1);
    const [keyframes, options] = animateMock.mock.calls[0] as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    expect(keyframes).toEqual([
      { transform: `translateY(${LIVENESS_SWEEP_START_VH}vh)` },
      { transform: `translateY(${LIVENESS_SWEEP_END_VH}vh)` },
    ]);
    expect(options.duration).toBe(LIVENESS_SWEEP_ONE_WAY_SECONDS * 1000);
    expect(options.iterations).toBe(Number.POSITIVE_INFINITY);
    expect(options.easing).toBe("linear");
    expect(options.direction).toBe("alternate");

    root.unmount();
  });
});

import { describe, expect, it } from "bun:test";
import {
  buildTickerStripeGradient,
  CHECK_SAMPLE_SCALE_PX,
  computeStripeXPeriodPx,
  computeTickerAnimationMs,
  computeTickerStripWidthPx,
  MIN_SCROLL_PX_PER_SECOND,
  OUTPUT_FPS,
  resolveTickerMotion,
  TICKER_SCROLL_SPEED_PX_PER_SECOND,
  TICKER_STRIP_TARGET_PX,
  TICKER_STRIPE_ANGLE_DEG,
  TICKER_STRIPE_DARK_COLOR,
  TICKER_STRIPE_LIGHT_COLOR,
  TICKER_STRIPE_PERIOD_PX,
  TickerRail,
} from "./TickerRail";

const X_PERIOD_PX = computeStripeXPeriodPx(
  TICKER_STRIPE_PERIOD_PX,
  TICKER_STRIPE_ANGLE_DEG,
);

describe("computeStripeXPeriodPx", () => {
  it("projects the stripe period onto the x axis (135deg diagonal)", () => {
    expect(X_PERIOD_PX).toBeCloseTo(TICKER_STRIPE_PERIOD_PX * Math.SQRT2, 9);
  });

  it("keeps the period unchanged for vertical stripes (90deg)", () => {
    expect(computeStripeXPeriodPx(16, 90)).toBe(16);
  });

  it("never repeats along x when the gradient axis is vertical", () => {
    expect(computeStripeXPeriodPx(16, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(computeStripeXPeriodPx(16, 180)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("computeTickerStripWidthPx", () => {
  it("is an integer number of x periods so the loop has no seam", () => {
    const stripWidthPx = computeTickerStripWidthPx(X_PERIOD_PX, 1920);
    expect(stripWidthPx / X_PERIOD_PX).toBeCloseTo(
      Math.round(stripWidthPx / X_PERIOD_PX),
      6,
    );
  });

  it("reaches at least the target width", () => {
    expect(computeTickerStripWidthPx(X_PERIOD_PX, 1920)).toBeGreaterThanOrEqual(
      1920,
    );
    expect(computeTickerStripWidthPx(X_PERIOD_PX, 1)).toBe(X_PERIOD_PX);
  });
});

describe("computeTickerAnimationMs", () => {
  it("advances one strip in exactly the time the speed allows", () => {
    expect(computeTickerAnimationMs(720, 360)).toBe(2000);
    expect(computeTickerAnimationMs(360, 360)).toBe(1000);
  });
});

describe("buildTickerStripeGradient", () => {
  it("paints a two-tone diagonal stripe of the given period", () => {
    expect(
      buildTickerStripeGradient(
        135,
        16,
        TICKER_STRIPE_DARK_COLOR,
        TICKER_STRIPE_LIGHT_COLOR,
      ),
    ).toBe(
      `repeating-linear-gradient(135deg, ${TICKER_STRIPE_DARK_COLOR} 0 8px, ${TICKER_STRIPE_LIGHT_COLOR} 8px 16px)`,
    );
  });

  it("never uses pure black (OBS keys it out)", () => {
    expect(TICKER_STRIPE_DARK_COLOR).not.toBe("#000000");
    expect(TICKER_STRIPE_LIGHT_COLOR).not.toBe("#000000");
  });
});

describe("stream-health motion contract (scripts/check-stream.ts)", () => {
  it("keeps the sampled picture moving at least one pixel per frame", () => {
    expect(MIN_SCROLL_PX_PER_SECOND).toBe(OUTPUT_FPS * CHECK_SAMPLE_SCALE_PX);
    expect(MIN_SCROLL_PX_PER_SECOND).toBe(300);
    expect(
      TICKER_SCROLL_SPEED_PX_PER_SECOND / OUTPUT_FPS,
    ).toBeGreaterThanOrEqual(CHECK_SAMPLE_SCALE_PX);
  });

  it("scrolls faster than the bare minimum", () => {
    expect(TICKER_SCROLL_SPEED_PX_PER_SECOND).toBeGreaterThan(
      MIN_SCROLL_PX_PER_SECOND,
    );
  });
});

describe("resolveTickerMotion", () => {
  const motion = resolveTickerMotion();

  it("covers the target width with a seamless strip", () => {
    expect(motion.stripWidthPx).toBeGreaterThanOrEqual(TICKER_STRIP_TARGET_PX);
    expect(motion.stripWidthPx / X_PERIOD_PX).toBeCloseTo(
      Math.round(motion.stripWidthPx / X_PERIOD_PX),
      6,
    );
  });

  it("animates exactly one strip per loop at the contract speed", () => {
    expect((motion.stripWidthPx / motion.animationMs) * 1000).toBeCloseTo(
      TICKER_SCROLL_SPEED_PX_PER_SECOND,
      6,
    );
    expect(motion.animationMs).toBeGreaterThan(0);
  });

  it("tiles the background by one x period", () => {
    expect(motion.backgroundSize).toBe(`${X_PERIOD_PX}px 100%`);
    expect(motion.gradient).toBe(
      buildTickerStripeGradient(
        TICKER_STRIPE_ANGLE_DEG,
        TICKER_STRIPE_PERIOD_PX,
        TICKER_STRIPE_DARK_COLOR,
        TICKER_STRIPE_LIGHT_COLOR,
      ),
    );
  });
});

describe("TickerRail", () => {
  // biome-ignore lint/suspicious/noExplicitAny: test-only vnode inspection
  const rail = TickerRail() as any;
  const animated = rail.props.children;
  // biome-ignore lint/suspicious/noExplicitAny: test-only vnode inspection
  const strips = animated.props.children as any[];

  it("is a decorative rail that never stops", () => {
    expect(rail.props["data-testid"]).toBe("stream-ticker");
    expect(rail.props["aria-hidden"]).toBe("true");
    expect(rail.props.className).toContain("overflow-hidden");
    expect(String(animated.props.style.animation)).toContain(
      "ticker-rail-scroll",
    );
    expect(String(animated.props.style.animation)).toContain("infinite");
  });

  it("lays two identical strips so -50% lands on a full loop", () => {
    expect(strips).toHaveLength(2);
    const motion = resolveTickerMotion();
    expect(strips[0].props.style.width).toBe(`${motion.stripWidthPx}px`);
    expect(strips[1].props.style.width).toBe(`${motion.stripWidthPx}px`);
    expect(strips[0].props.style).toEqual(strips[1].props.style);
    expect(strips[0].props.style.backgroundImage).toContain(
      "repeating-linear-gradient",
    );
  });
});

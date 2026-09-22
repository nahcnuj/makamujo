import { describe, expect, it } from "bun:test";
import {
  computeVoltageWidthPercent,
  isOverVoltage,
  shouldRenderVoltage,
} from "./DeliveryVoltage";

describe("computeVoltageWidthPercent", () => {
  it("scales by log10 ratio toward the previous stream max", () => {
    expect(computeVoltageWidthPercent(10, 999)).toBeCloseTo((1 / 3) * 100, 6);
    expect(computeVoltageWidthPercent(1000, 999)).toBeCloseTo(100, 6);
  });

  it("caps at 100 when comments exceed the previous stream max", () => {
    expect(computeVoltageWidthPercent(200, 100)).toBe(100);
    expect(computeVoltageWidthPercent(1000000, 100)).toBe(100);
  });

  it("is 0 with no comments", () => {
    expect(computeVoltageWidthPercent(0, 999)).toBe(0);
  });

  it("is 0 when there is no previous stream baseline", () => {
    expect(computeVoltageWidthPercent(0, 0)).toBe(0);
  });
});

describe("isOverVoltage", () => {
  it("is true only when comments exceed the previous max n + 1", () => {
    expect(isOverVoltage(101, 100)).toBe(false);
    expect(isOverVoltage(102, 100)).toBe(true);
  });
});

describe("shouldRenderVoltage", () => {
  it("hides the gauge only with no prior stream and no comments", () => {
    expect(shouldRenderVoltage(0, 0)).toBe(false);
    expect(shouldRenderVoltage(1, 0)).toBe(true);
    expect(shouldRenderVoltage(0, 1)).toBe(true);
  });
});

import { describe, expect, it } from "bun:test";
import {
  computeVoltageHeight,
  computeVoltageHeightEm,
  computeVoltageNGram,
  computeVoltageWidthPercent,
  isOverVoltage,
  shouldRenderVoltage,
  VOLTAGE_BAR_HEIGHT,
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

describe("computeVoltageHeightEm", () => {
  it("treats the current 0.5em bar as the 2-gram height", () => {
    expect(computeVoltageHeightEm(2)).toBe(0.5);
    expect(computeVoltageHeightEm(1)).toBe(0.25);
    expect(computeVoltageHeightEm(4)).toBe(1);
  });

  it("falls back to the 2-gram height for invalid n-gram values", () => {
    expect(computeVoltageHeightEm(0)).toBe(0.5);
    expect(computeVoltageHeightEm(Number.NaN)).toBe(0.5);
  });
});

describe("computeVoltageHeight", () => {
  it("renders the proportionally scaled height in em units", () => {
    expect(computeVoltageHeight(2)).toBe("0.5em");
    expect(computeVoltageHeight(3)).toBe("0.75em");
    expect(VOLTAGE_BAR_HEIGHT).toBe("0.5em");
  });
});

describe("computeVoltageNGram", () => {
  it("infers the n-gram size from the comment count", () => {
    expect(computeVoltageNGram(1)).toBe(1);
    expect(computeVoltageNGram(100)).toBe(2);
    expect(computeVoltageNGram(1000)).toBe(4);
  });
});

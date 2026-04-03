import { describe, expect, it } from "bun:test";
import { calculateHourAngle, calculateMinuteAngle, calculateSecondAngle } from "./AnalogClock";

describe("calculateHourAngle", () => {
  it("returns 0 at midnight (0:00)", () => {
    expect(calculateHourAngle(0, 0)).toBe(0);
  });

  it("returns 90 at 3:00", () => {
    expect(calculateHourAngle(3, 0)).toBe(90);
  });

  it("returns 180 at 6:00", () => {
    expect(calculateHourAngle(6, 0)).toBe(180);
  });

  it("returns 270 at 9:00", () => {
    expect(calculateHourAngle(9, 0)).toBe(270);
  });

  it("returns 0 at 12:00 (same position as midnight)", () => {
    expect(calculateHourAngle(12, 0)).toBe(0);
  });

  it("returns the same angle for 0:00 and 12:00", () => {
    expect(calculateHourAngle(0, 0)).toBe(calculateHourAngle(12, 0));
  });

  it("accounts for minutes at 3:30 (90 + 15 = 105)", () => {
    expect(calculateHourAngle(3, 30)).toBe(105);
  });

  it("accounts for minutes at 12:30 (0 + 15 = 15)", () => {
    expect(calculateHourAngle(12, 30)).toBe(15);
  });
});

describe("calculateMinuteAngle", () => {
  it("returns 0 at 0 minutes 0 seconds", () => {
    expect(calculateMinuteAngle(0, 0)).toBe(0);
  });

  it("returns 180 at 30 minutes", () => {
    expect(calculateMinuteAngle(30, 0)).toBe(180);
  });

  it("returns 360 at 60 minutes", () => {
    expect(calculateMinuteAngle(60, 0)).toBe(360);
  });

  it("accounts for seconds at 30m 30s (180 + 3 = 183)", () => {
    expect(calculateMinuteAngle(30, 30)).toBe(183);
  });

  it("accounts for seconds at 0m 30s (0 + 3 = 3)", () => {
    expect(calculateMinuteAngle(0, 30)).toBe(3);
  });
});

describe("calculateSecondAngle", () => {
  it("returns 0 at 0 seconds", () => {
    expect(calculateSecondAngle(0)).toBe(0);
  });

  it("returns 180 at 30 seconds", () => {
    expect(calculateSecondAngle(30)).toBe(180);
  });

  it("returns 360 at 60 seconds", () => {
    expect(calculateSecondAngle(60)).toBe(360);
  });

  it("returns 6 per second", () => {
    expect(calculateSecondAngle(1)).toBe(6);
    expect(calculateSecondAngle(10)).toBe(60);
    expect(calculateSecondAngle(45)).toBe(270);
  });
});

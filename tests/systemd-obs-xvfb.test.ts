import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const OBS_UNIT = "etc/systemd/makamujo-obs.service";

const unitDirectives = (unit: string, key: string): string[] =>
  unit
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${key}=`))
    .flatMap((line) => line.slice(key.length + 1).split(/\s+/))
    .filter((value) => value.length > 0);

const hasDependency = (values: string[], expected: string): boolean =>
  values.includes(expected);

describe("makamujo-obs.service", () => {
  const unit = readFileSync(OBS_UNIT, "utf-8");

  it("starts after the streaming display, so OBS never opens against a dead X server", () => {
    expect(
      hasDependency(unitDirectives(unit, "After"), "makamujo-xvfb.service"),
    ).toBe(true);
  });

  it("is part of makamujo-xvfb.service so a display restart also restarts OBS", () => {
    // OBS's hotkey thread polls its own X11 connection. Stopping Xvfb while OBS
    // keeps running breaks that connection and segfaults the libobs hotkey
    // thread (issue #1610). PartOf= propagates the restart; After= makes the
    // stop order reverse, so OBS is torn down before Xvfb.
    expect(
      hasDependency(unitDirectives(unit, "PartOf"), "makamujo-xvfb.service"),
    ).toBe(true);
  });

  it("keeps the display as a start-time dependency but not a start gate", () => {
    expect(
      hasDependency(unitDirectives(unit, "Wants"), "makamujo-xvfb.service"),
    ).toBe(true);
  });
});

import { describe, expect, it } from "bun:test";
import { formatCountWithIcon } from "./GamePanel";

describe("formatCountWithIcon", () => {
  it("formats a positive count with grouping and appends the icon", () => {
    expect(formatCountWithIcon(1234, "🎁")).toBe("1,234🎁");
    expect(formatCountWithIcon(7, "📣")).toBe("7📣");
  });

  it("keeps the row height stable: renders the icon alone when the count is zero", () => {
    expect(formatCountWithIcon(0, "🎁")).toBe("🎁");
    expect(formatCountWithIcon(0, "📣")).toBe("📣");
  });

  it("keeps the row height stable: renders the icon alone when the count is missing", () => {
    expect(formatCountWithIcon(undefined, "🎁")).toBe("🎁");
    expect(formatCountWithIcon(undefined, "📣")).toBe("📣");
  });
});

import { describe, expect, it } from "bun:test";
import { shouldShowAgentStatusErrorForEventSourceError } from "./agentStatusState";

describe("agentStatusState", () => {
  it("reports an error only when the EventSource is fully closed", () => {
    expect(shouldShowAgentStatusErrorForEventSourceError(0)).toBe(false);
    expect(shouldShowAgentStatusErrorForEventSourceError(1)).toBe(false);
    expect(shouldShowAgentStatusErrorForEventSourceError(2)).toBe(true);
    expect(shouldShowAgentStatusErrorForEventSourceError(-1)).toBe(false);
  });
});

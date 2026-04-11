import { describe, expect, it, beforeEach } from "bun:test";
import { setAllowedIP, isIPAllowed } from "./allowedIP";

describe("isIPAllowed", () => {
  beforeEach(() => {
    // Reset state before each test by setting an invalid placeholder address
    // that no real IP in any test case will match.
    setAllowedIP("__reset__", "__reset__");
  });

  it("returns false when ip is null", () => {
    setAllowedIP("IPv4", "10.0.0.1");
    expect(isIPAllowed(null)).toBe(false);
  });

  it("returns false when ip is undefined", () => {
    setAllowedIP("IPv4", "10.0.0.1");
    expect(isIPAllowed(undefined)).toBe(false);
  });

  it("returns true when ip matches the allowed IP", () => {
    setAllowedIP("IPv4", "10.0.0.1");
    expect(isIPAllowed({ family: "IPv4", address: "10.0.0.1" })).toBe(true);
  });

  it("returns false when address differs", () => {
    setAllowedIP("IPv4", "10.0.0.1");
    expect(isIPAllowed({ family: "IPv4", address: "10.0.0.2" })).toBe(false);
  });

  it("returns false when family differs", () => {
    setAllowedIP("IPv4", "::1");
    expect(isIPAllowed({ family: "IPv6", address: "::1" })).toBe(false);
  });

  it("returns true for IPv6 address when it matches", () => {
    setAllowedIP("IPv6", "::1");
    expect(isIPAllowed({ family: "IPv6", address: "::1" })).toBe(true);
  });

  it("returns false for the old IP after setAllowedIP is called with a new IP", () => {
    setAllowedIP("IPv4", "10.0.0.1");
    setAllowedIP("IPv4", "10.0.0.2");
    expect(isIPAllowed({ family: "IPv4", address: "10.0.0.1" })).toBe(false);
    expect(isIPAllowed({ family: "IPv4", address: "10.0.0.2" })).toBe(true);
  });
});

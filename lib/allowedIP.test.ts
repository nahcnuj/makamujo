import { describe, expect, it, beforeEach } from "bun:test";
import { AllowedIP, setAllowedIP, isIPAllowed } from "./allowedIP";

describe("AllowedIP", () => {
  describe("from", () => {
    it("returns null when given null", () => {
      expect(AllowedIP.from(null)).toBeNull();
    });

    it("returns null when given undefined", () => {
      expect(AllowedIP.from(undefined)).toBeNull();
    });

    it("creates an AllowedIP from a raw object", () => {
      const ip = AllowedIP.from({ family: "IPv4", address: "10.0.0.1" });
      expect(ip).not.toBeNull();
      expect(ip!.family).toBe("IPv4");
      expect(ip!.address).toBe("10.0.0.1");
    });
  });

  describe("equals", () => {
    it("returns true for the same family and address", () => {
      const a = new AllowedIP("IPv4", "10.0.0.1");
      const b = new AllowedIP("IPv4", "10.0.0.1");
      expect(a.equals(b)).toBe(true);
    });

    it("returns false when address differs", () => {
      const a = new AllowedIP("IPv4", "10.0.0.1");
      const b = new AllowedIP("IPv4", "10.0.0.2");
      expect(a.equals(b)).toBe(false);
    });

    it("returns false when family differs", () => {
      const a = new AllowedIP("IPv4", "::1");
      const b = new AllowedIP("IPv6", "::1");
      expect(a.equals(b)).toBe(false);
    });
  });
});

describe("isIPAllowed", () => {
  beforeEach(() => {
    // Reset state before each test by setting an address that no real test case will match.
    setAllowedIP({ family: "__reset__", address: "__reset__" });
  });

  it("returns false when ip is null", () => {
    setAllowedIP({ family: "IPv4", address: "10.0.0.1" });
    expect(isIPAllowed(null)).toBe(false);
  });

  it("returns false when ip is undefined", () => {
    setAllowedIP({ family: "IPv4", address: "10.0.0.1" });
    expect(isIPAllowed(undefined)).toBe(false);
  });

  it("returns true when ip matches the allowed IP", () => {
    setAllowedIP({ family: "IPv4", address: "10.0.0.1" });
    expect(isIPAllowed({ family: "IPv4", address: "10.0.0.1" })).toBe(true);
  });

  it("returns false when address differs", () => {
    setAllowedIP({ family: "IPv4", address: "10.0.0.1" });
    expect(isIPAllowed({ family: "IPv4", address: "10.0.0.2" })).toBe(false);
  });

  it("returns false when family differs", () => {
    setAllowedIP({ family: "IPv4", address: "::1" });
    expect(isIPAllowed({ family: "IPv6", address: "::1" })).toBe(false);
  });

  it("returns true for IPv6 address when it matches", () => {
    setAllowedIP({ family: "IPv6", address: "::1" });
    expect(isIPAllowed({ family: "IPv6", address: "::1" })).toBe(true);
  });

  it("returns false for the old IP after setAllowedIP is called with a new IP", () => {
    setAllowedIP({ family: "IPv4", address: "10.0.0.1" });
    setAllowedIP({ family: "IPv4", address: "10.0.0.2" });
    expect(isIPAllowed({ family: "IPv4", address: "10.0.0.1" })).toBe(false);
    expect(isIPAllowed({ family: "IPv4", address: "10.0.0.2" })).toBe(true);
  });
});

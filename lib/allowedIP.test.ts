import { describe, expect, it, beforeEach } from "bun:test";
import { AllowedIP } from "./allowedIP";

describe("AllowedIP", () => {
  beforeEach(() => {
    AllowedIP.clear();
  });

  describe("equals", () => {
    it("returns false when no IP has been set", () => {
      expect(AllowedIP.equals({ family: "IPv4", address: "10.0.0.1" })).toBe(false);
    });

    it("returns false after clear is called", () => {
      AllowedIP.set({ family: "IPv4", address: "10.0.0.1" });
      AllowedIP.clear();
      expect(AllowedIP.equals({ family: "IPv4", address: "10.0.0.1" })).toBe(false);
    });

    it("returns true when ip matches the allowed IP", () => {
      AllowedIP.set({ family: "IPv4", address: "10.0.0.1" });
      expect(AllowedIP.equals({ family: "IPv4", address: "10.0.0.1" })).toBe(true);
    });

    it("returns false when address differs", () => {
      AllowedIP.set({ family: "IPv4", address: "10.0.0.1" });
      expect(AllowedIP.equals({ family: "IPv4", address: "10.0.0.2" })).toBe(false);
    });

    it("returns false when family differs", () => {
      AllowedIP.set({ family: "IPv4", address: "::1" });
      expect(AllowedIP.equals({ family: "IPv6", address: "::1" })).toBe(false);
    });

    it("returns true for IPv6 address when it matches", () => {
      AllowedIP.set({ family: "IPv6", address: "::1" });
      expect(AllowedIP.equals({ family: "IPv6", address: "::1" })).toBe(true);
    });

    it("returns false for the old IP after set is called with a new IP", () => {
      AllowedIP.set({ family: "IPv4", address: "10.0.0.1" });
      AllowedIP.set({ family: "IPv4", address: "10.0.0.2" });
      expect(AllowedIP.equals({ family: "IPv4", address: "10.0.0.1" })).toBe(false);
      expect(AllowedIP.equals({ family: "IPv4", address: "10.0.0.2" })).toBe(true);
    });
  });
});

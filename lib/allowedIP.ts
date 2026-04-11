/**
 * Shared IP allowlist mechanism for the broadcasting screen server and the management console server.
 *
 * The allowed IP is set by the broadcasting screen server when a client connects,
 * and all subsequent requests to both servers are checked against it.
 */

/** Immutable value object representing an IP address with its address family. */
export class AllowedIP {
  constructor(
    readonly family: string,
    readonly address: string,
  ) {}

  /**
   * Create an AllowedIP from a Bun `requestIP()` result.
   * Returns null when the raw value is null or undefined.
   */
  static from(raw: { family: string; address: string } | null | undefined): AllowedIP | null {
    if (!raw) return null;
    return new AllowedIP(raw.family, raw.address);
  }

  /** Returns true when both family and address are equal. */
  equals(other: AllowedIP): boolean {
    return this.family === other.family && this.address === other.address;
  }
}

let allowedIP: AllowedIP | null = null;

/**
 * Set the allowed IP address.
 */
export function setAllowedIP(ip: AllowedIP): void {
  allowedIP = ip;
}

/**
 * Check if the given IP address is the currently allowed IP.
 * Returns false if no IP has been set yet or if the IP does not match.
 */
export function isIPAllowed(ip: AllowedIP | null | undefined): boolean {
  if (!allowedIP || !ip) return false;
  return allowedIP.equals(ip);
}

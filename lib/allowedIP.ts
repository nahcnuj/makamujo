/**
 * Shared IP allowlist mechanism for the broadcasting screen server and the management console server.
 *
 * The allowed IP is set by the broadcasting screen server when a client connects,
 * and all subsequent requests to both servers are checked against it.
 */

let allowedIP: AllowedIP | null = null;

/** Immutable value object representing an allowed IP address with its address family. */
export class AllowedIP {
  private constructor(
    private readonly family: string,
    private readonly address: string,
  ) {}

  /**
   * Set the allowed IP address from a Bun `requestIP()` result.
   * @param ip - An object with `family` and `address` properties, as returned by `server.requestIP()`.
   */
  static set(ip: { family: string; address: string }): void {
    allowedIP = new AllowedIP(ip.family, ip.address);
  }

  /**
   * Check if the given IP matches the currently allowed IP.
   * @param ip - An object with `family` and `address` properties, as returned by `server.requestIP()`.
   * @returns `true` if the given IP matches the allowed IP; `false` if no IP has been set or the IP does not match.
   */
  static equals(ip: { family: string; address: string }): boolean {
    if (!allowedIP) return false;
    return allowedIP.family === ip.family && allowedIP.address === ip.address;
  }

  /** Clear the allowed IP, returning to the initial unset state. */
  static clear(): void {
    allowedIP = null;
  }
}

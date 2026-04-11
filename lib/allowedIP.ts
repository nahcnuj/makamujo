/**
 * Shared IP allowlist mechanism for the broadcasting screen server and the management console server.
 *
 * The allowed IP is set by the broadcasting screen server when a client connects,
 * and all subsequent requests to both servers are checked against it.
 */

let allowedIP = '';

/**
 * Set the allowed IP address.
 * @param family - The IP address family (IPv4 or IPv6).
 * @param address - The IP address string.
 */
export function setAllowedIP(family: string, address: string): void {
  allowedIP = `${family}/${address}`;
}

/**
 * Check if the given IP address is the currently allowed IP.
 * Returns false if no IP has been set yet or if the IP does not match.
 */
export function isIPAllowed(ip: { family: string; address: string } | null | undefined): boolean {
  if (!allowedIP || !ip) return false;
  return `${ip.family}/${ip.address}` === allowedIP;
}

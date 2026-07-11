/**
 * Console access-control and reverse-proxy header pure rules.
 * Side-effect free — used by the outer TLS console server.
 */

export const DEFAULT_CONSOLE_BASE_PATH = "/console/";

/**
 * Build the redirect response used when an access to the outer console server is denied.
 *
 * - Requests to `/console/` (including descendants) are redirected to the configured watch page.
 * - Requests to all other paths are permanently redirected to `/console/`.
 */
export const createAccessDeniedRedirectResponse = (
  requestURL: URL,
  options: {
    consoleBasePath?: string;
    consoleRedirectURL: string;
  },
): Response => {
  const consoleBasePath = options.consoleBasePath ?? DEFAULT_CONSOLE_BASE_PATH;
  if (requestURL.pathname.startsWith(consoleBasePath)) {
    return Response.redirect(options.consoleRedirectURL, 303);
  }
  return new Response(null, {
    status: 308,
    headers: { location: consoleBasePath },
  });
};

/** IP restriction applies only in production (legacy behavior). */
export const isConsoleIPRestrictionEnabled = (
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean => nodeEnv === "production";

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
] as const;

/**
 * Headers safe to forward from the outer console to the loopback console.
 * Strips hop-by-hop headers (RFC 7230), Host, Origin, and Referer.
 */
export const createLoopbackProxyHeaders = (originalHeaders: Headers): Headers => {
  const headers = new Headers(originalHeaders);
  const connectionValue = headers.get("connection");
  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");
  if (connectionValue) {
    for (const token of connectionValue.split(",").map((t) => t.trim().toLowerCase())) {
      if (token) headers.delete(token);
    }
  }
  return headers;
};

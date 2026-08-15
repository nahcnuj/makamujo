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

const BASIC_AUTH_PASSWORD_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Generate a random console Basic-auth password (16 chars).
 * Ported from main #426 for journalctl retrieval on service start.
 */
export const generateConsoleBasicAuthPassword = (
  randomBytes: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
): string =>
  Array.from(randomBytes)
    .map(
      (byte) =>
        BASIC_AUTH_PASSWORD_CHARS[byte % BASIC_AUTH_PASSWORD_CHARS.length]!,
    )
    .join("");

/**
 * Resolve the console Basic-auth password: env wins; otherwise generate and
 * return `{ password, generated: true }` so the host can log it once.
 */
export const resolveConsoleBasicAuthPassword = (
  envPassword: string | undefined = process.env.CONSOLE_BASIC_AUTH_PASSWORD,
): { password: string; generated: boolean } => {
  if (envPassword) {
    return { password: envPassword, generated: false };
  }
  return { password: generateConsoleBasicAuthPassword(), generated: true };
};

/** Parse `Authorization: Basic …` into username/password, or null if invalid. */
export const parseBasicAuthCredentials = (
  value: string | null,
): { username: string; password: string } | null => {
  if (!value) return null;
  const parts = value.split(" ");
  if (parts.length !== 2 || parts[0] !== "Basic" || !parts[1]) return null;
  let decoded: string;
  try {
    decoded = atob(parts[1]);
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
};

/** True when Authorization matches admin + expected password. */
export const hasValidConsoleAuthorization = (
  authorizationHeader: string | null,
  expectedPassword: string,
  expectedUsername = "admin",
): boolean => {
  const credentials = parseBasicAuthCredentials(authorizationHeader);
  return (
    credentials !== null &&
    credentials.username === expectedUsername &&
    credentials.password === expectedPassword
  );
};

export const createUnauthorizedConsoleResponse = (): Response =>
  new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="makamujo-console"',
    },
  });

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
export const createLoopbackProxyHeaders = (
  originalHeaders: Headers,
): Headers => {
  const headers = new Headers(originalHeaders);
  const connectionValue = headers.get("connection");
  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");
  if (connectionValue) {
    for (const token of connectionValue
      .split(",")
      .map((t) => t.trim().toLowerCase())) {
      if (token) headers.delete(token);
    }
  }
  return headers;
};

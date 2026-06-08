import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "bun";
import {
  createDailyRotatingJsonLogger,
  formatUnknownError,
} from "../lib/consoleLogger";
import * as consoleRoutes from "../routes/console/index";

const consoleCertPath =
  process.env.CONSOLE_TLS_CERT ??
  "/etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/fullchain.pem";
const consoleKeyPath =
  process.env.CONSOLE_TLS_KEY ??
  "/etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/privkey.pem";
export const consoleRedirectURL =
  process.env.CONSOLE_REDIRECT_URL ??
  "https://live.nicovideo.jp/watch/user/14171889";
const consoleAccessLogPath = resolve(
  process.cwd(),
  "var/log/console/access.log",
);
const consoleErrorLogPath = resolve(process.cwd(), "var/log/console/error.log");
export const consoleBasePath = "/console/";

export type ConsoleServer = {
  readonly url: URL;
  stop(closeActiveConnections?: boolean): void;
};

/**
 * Build the redirect response used when an access to the outer console server is denied.
 *
 * - Requests to `/console/` (including descendants) are redirected to the configured watch page.
 * - Requests to all other paths are permanently redirected to `/console/`.
 *
 * @param requestURL - Original request URL.
 * @returns Redirect response with status and location based on the request path.
 */
export function createAccessDeniedRedirectResponse(requestURL: URL): Response {
  if (requestURL.pathname.startsWith(consoleBasePath)) {
    return Response.redirect(consoleRedirectURL, 303);
  }
  return new Response(null, {
    status: 308,
    headers: { location: consoleBasePath },
  });
}

export function isConsoleIPRestrictionEnabled(): boolean {
  return process.env.NODE_ENV === "production";
}

function createConsoleUnauthorizedResponse(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="console"' },
  });
}

function parseBasicAuthCredentials(
  value: string | null,
): { username: string; password: string } | null {
  if (!value) return null;
  const parts = value.split(" ");
  if (parts.length !== 2 || parts[0] !== "Basic") return null;
  const encoded = parts[1];
  if (!encoded) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }

  const [username, password] = decoded.split(":");
  if (username === undefined || password === undefined) return null;
  return { username, password };
}

function hasValidConsoleAuthorization(
  authorizationHeader: string | null,
  expectedPassword: string,
): boolean {
  const credentials = parseBasicAuthCredentials(authorizationHeader);
  return (
    credentials !== null &&
    credentials.username === "admin" &&
    credentials.password === expectedPassword
  );
}

export function createLoopbackProxyHeaders(originalHeaders: Headers): Headers {
  const headers = new Headers(originalHeaders);
  // Save Connection header value before removing it, so we can strip RFC 7230 tokens after.
  const connectionValue = headers.get("connection");
  const hopByHopHeaders = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
  ];
  for (const header of hopByHopHeaders) {
    headers.delete(header);
  }
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");
  // Per RFC 7230, also remove any header names listed in the Connection header value.
  if (connectionValue) {
    for (const token of connectionValue
      .split(",")
      .map((t) => t.trim().toLowerCase())) {
      if (token) headers.delete(token);
    }
  }
  return headers;
}

/**
 * Start the console server.
 *
 * Internally uses two servers:
 * - A loopback server that serves all console routes (including HTML bundling) on 127.0.0.1.
 * - An outer server on port 443 that enforces IP allowlist and proxies permitted requests to the loopback server.
 *
 * The returned handle exposes only the outer server's URL and a unified `stop()` method.
 *
 * @param certPath - Path to the TLS certificate file. Defaults to the `CONSOLE_TLS_CERT` env var.
 * @param keyPath  - Path to the TLS private key file. Defaults to the `CONSOLE_TLS_KEY` env var.
 * @returns A handle with the outer server's URL and a unified `stop()` method.
 */
export type StartConsoleServerOptions = {
  certPath?: string;
  keyPath?: string;
  broadcastingHost?: string;
  broadcastingPort?: number | string;
};

export function startConsoleServer({
  certPath = consoleCertPath,
  keyPath = consoleKeyPath,
  broadcastingHost = process.env.BROADCASTING_HOST ?? "localhost",
  broadcastingPort = process.env.BROADCASTING_PORT ?? "7777",
}: StartConsoleServerOptions = {}): ConsoleServer {
  const accessLogger = createDailyRotatingJsonLogger(consoleAccessLogPath);
  const errorLogger = createDailyRotatingJsonLogger(consoleErrorLogPath);

  // Configure the console loopback proxy to route requests to the current
  // broadcasting server. This avoids relying on an external BROADCASTING_PORT
  // environment variable in development.
  consoleRoutes.setBroadcastingTarget(broadcastingHost, broadcastingPort);

  // Loopback console server: binds to 127.0.0.1 only and serves all console routes.
  // Not exposed to the public network.
  const loopbackServer = serve({
    port: 0, // OS assigns a random available port
    hostname: "127.0.0.1",
    fetch: (req: Request) => consoleRoutes.app.fetch(req),
    websocket: consoleRoutes.websocket,
  });

  const loopbackConsolePort = loopbackServer.port;
  let consoleBasicAuthPassword = process.env.CONSOLE_BASIC_AUTH_PASSWORD;
  const consoleAccessControlEnabled = isConsoleIPRestrictionEnabled();

  // If running in loopback-only mode (used by tests), return the loopback
  // server without attempting to start the outer TLS-enabled server.
  if (process.env.CONSOLE_LOOPBACK_ONLY === "1") {
    return {
      get url() {
        return loopbackServer.url;
      },
      stop(closeActiveConnections?: boolean) {
        loopbackServer.stop(closeActiveConnections);
      },
    };
  }

  // Generate password at startup if not provided, and log it for retrieving
  if (!consoleBasicAuthPassword) {
    // Generate a random password (16 characters, alphanumeric + some special chars)
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    consoleBasicAuthPassword = Array.from(randomBytes)
      .map((byte) => chars[byte % chars.length])
      .join("");
    console.log(`Console Basic auth password: ${consoleBasicAuthPassword}`);
  }

  if (consoleAccessControlEnabled && !consoleBasicAuthPassword) {
    loopbackServer.stop(true);
    throw new Error(
      "Console basic auth password is required in production via CONSOLE_BASIC_AUTH_PASSWORD.",
    );
  }

  // Fail fast if TLS cert/key files are missing before starting the outer server.
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    loopbackServer.stop(true);
    throw new Error(
      `TLS certificate files not found at the resolved paths. ` +
        `certPath=${JSON.stringify(certPath)}, keyPath=${JSON.stringify(keyPath)}. ` +
        `Provide valid certPath/keyPath arguments or set CONSOLE_TLS_CERT and CONSOLE_TLS_KEY env vars to the correct paths.`,
    );
  }

  // Outer console server: exposed publicly on port 443.
  // Protects access with Basic authentication before proxying to the loopback server.
  type OuterWsData = {
    loopbackWsUrl: string;
    protocols: string[] | undefined;
    target?: WebSocket;
  };

  const outerWebSocket: Bun.WebSocketHandler<OuterWsData> = {
    open(ws) {
      const { loopbackWsUrl, protocols } = ws.data;
      try {
        const target = new WebSocket(loopbackWsUrl, protocols);

        target.binaryType = "arraybuffer";

        target.onopen = () => {
          // noop
        };

        target.onmessage = (ev) => {
          try {
            ws.send(ev.data as string | ArrayBuffer);
          } catch {}
        };

        target.onclose = () => {
          try {
            ws.close();
          } catch {}
        };
        target.onerror = () => {
          try {
            ws.close();
          } catch {}
        };

        ws.data.target = target;
      } catch (err) {
        try {
          ws.close();
        } catch {}
      }
    },
    message(ws, data) {
      const { target } = ws.data;
      if (target)
        try {
          target.send(data as string | ArrayBuffer);
        } catch {}
    },
    close(ws) {
      const { target } = ws.data;
      if (target)
        try {
          target.close();
        } catch {}
    },
  };

  let outerServer: ReturnType<typeof serve>;
  try {
    outerServer = serve<OuterWsData>({
      port: 443,
      async fetch(req, server) {
        const requestStartTime = Date.now();
        const requestURL = new URL(req.url);
        const userAgent = req.headers.get("user-agent");
        const referer = req.headers.get("referer");
        const ip = server.requestIP(req);
        const clientIpAddress = ip ? `${ip.family}/${ip.address}` : "unknown";
        let statusCode = 500;

        if (
          consoleAccessControlEnabled &&
          !hasValidConsoleAuthorization(
            req.headers.get("authorization"),
            consoleBasicAuthPassword,
          )
        ) {
          statusCode = 401;
          errorLogger.write({
            event: "console_unauthorized",
            clientIp: clientIpAddress,
            method: req.method,
            path: requestURL.pathname,
            query: requestURL.search,
            userAgent,
            referer,
          });
          accessLogger.write({
            event: "console_access",
            clientIp: clientIpAddress,
            method: req.method,
            path: requestURL.pathname,
            query: requestURL.search,
            status: statusCode,
            responseTimeMs: Date.now() - requestStartTime,
            userAgent,
            referer,
          });
          return createConsoleUnauthorizedResponse();
        }

        try {
          // Proxy to the loopback console server, which handles routing.
          const proxyURL = new URL(req.url);
          proxyURL.protocol = "http:";
          proxyURL.hostname = "127.0.0.1";
          proxyURL.port = String(loopbackConsolePort);

          // If this is an incoming WebSocket upgrade, proxy the upgrade by
          // accepting the client's WebSocket and creating a client WebSocket
          // to the loopback server, then bridge messages between them. Using
          // `fetch` here cannot proxy WebSocket upgrade handshakes.
          const upgradeHeader = (
            req.headers.get("upgrade") || ""
          ).toLowerCase();
          if (upgradeHeader === "websocket") {
            try {
              const wsPath = `${proxyURL.pathname}${proxyURL.search}`;
              const loopbackWsUrl = `ws://127.0.0.1:${loopbackConsolePort}${wsPath}`;
              const protocolsHeader = req.headers.get("sec-websocket-protocol");
              const protocols = protocolsHeader
                ? protocolsHeader.split(",").map((s) => s.trim())
                : undefined;
              const upgraded = server.upgrade(req, {
                data: { loopbackWsUrl, protocols },
              });
              if (!upgraded) {
                statusCode = 502;
                errorLogger.write({
                  event: "console_ws_proxy_failed",
                  clientIp: clientIpAddress,
                  method: req.method,
                  path: requestURL.pathname,
                  query: requestURL.search,
                  error: "WebSocket upgrade failed",
                  userAgent,
                  referer,
                });
                return new Response("Bad Gateway", { status: 502 });
              }
              statusCode = 101;
              return undefined;
            } catch (err) {
              statusCode = 502;
              errorLogger.write({
                event: "console_ws_proxy_failed",
                clientIp: clientIpAddress,
                method: req.method,
                path: requestURL.pathname,
                query: requestURL.search,
                error: formatUnknownError(err),
                userAgent,
                referer,
              });
              return new Response("Bad Gateway", { status: 502 });
            }
          }

          // Strip hop-by-hop and origin-specific headers that should not be forwarded as-is.
          const proxyHeaders = createLoopbackProxyHeaders(req.headers);

          const response = await fetch(proxyURL.toString(), {
            method: req.method,
            headers: proxyHeaders,
            body: req.body,
          });
          statusCode = response.status;
          return response;
        } catch (err) {
          statusCode = 502;
          errorLogger.write({
            event: "console_proxy_failed",
            clientIp: clientIpAddress,
            method: req.method,
            path: requestURL.pathname,
            query: requestURL.search,
            error: formatUnknownError(err),
            userAgent,
            referer,
          });
          return new Response("Bad Gateway", { status: 502 });
        } finally {
          accessLogger.write({
            event: "console_access",
            clientIp: clientIpAddress,
            method: req.method,
            path: requestURL.pathname,
            query: requestURL.search,
            status: statusCode,
            responseTimeMs: Date.now() - requestStartTime,
            userAgent,
            referer,
          });
        }
      },
      websocket: outerWebSocket,
      tls: {
        cert: Bun.file(certPath),
        key: Bun.file(keyPath),
      },
    });
  } catch (err) {
    loopbackServer.stop(true);
    throw err;
  }

  return {
    get url() {
      return outerServer.url;
    },
    stop(closeActiveConnections?: boolean) {
      loopbackServer.stop(closeActiveConnections);
      outerServer.stop(closeActiveConnections);
    },
  };
}

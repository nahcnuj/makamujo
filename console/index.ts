import { serve } from "bun";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AllowedIP } from "../lib/allowedIP";
import { createDailyRotatingJsonLogger, formatUnknownError } from "../lib/consoleLogger";
import * as consoleRoutes from "../routes/console/index";

const consoleCertPath = process.env.CONSOLE_TLS_CERT ?? '/etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/fullchain.pem';
const consoleKeyPath = process.env.CONSOLE_TLS_KEY ?? '/etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/privkey.pem';
export const consoleRedirectURL = process.env.CONSOLE_REDIRECT_URL ?? 'https://live.nicovideo.jp/watch/user/14171889';
const consoleAccessLogPath = resolve(process.cwd(), 'var/log/console/access.log');
const consoleErrorLogPath = resolve(process.cwd(), 'var/log/console/error.log');
export const consoleBasePath = '/console/';

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
export function startConsoleServer(certPath: string = consoleCertPath, keyPath: string = consoleKeyPath): ConsoleServer {
  const accessLogger = createDailyRotatingJsonLogger(consoleAccessLogPath);
  const errorLogger = createDailyRotatingJsonLogger(consoleErrorLogPath);

  // Loopback console server: binds to 127.0.0.1 only and serves all console routes
  // (including HTML bundling). Not exposed to the public network.
  const loopbackServer = serve({
    port: 0, // OS assigns a random available port
    hostname: '127.0.0.1',
    routes: consoleRoutes.routes,
    development: process.env.NODE_ENV !== "production" && {
      // Enable browser hot reloading in development
      hmr: true,

      // Echo console logs from the browser to the server
      console: true,
    },
  });

  const loopbackConsolePort = loopbackServer.port;

  // If running in loopback-only mode (used by tests), return the loopback
  // server without attempting to start the outer TLS-enabled server.
  if (process.env.CONSOLE_LOOPBACK_ONLY === '1') {
    return {
      get url() { return loopbackServer.url; },
      stop(closeActiveConnections?: boolean) {
        loopbackServer.stop(closeActiveConnections);
      },
    };
  }

  // Fail fast if TLS cert/key files are missing before starting the outer server.
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    loopbackServer.stop(true);
    throw new Error(
      `TLS certificate files not found at the resolved paths. ` +
      `certPath=${JSON.stringify(certPath)}, keyPath=${JSON.stringify(keyPath)}. ` +
      `Provide valid certPath/keyPath arguments or set CONSOLE_TLS_CERT and CONSOLE_TLS_KEY env vars to the correct paths.`
    );
  }

  // Outer console server: exposed publicly on port 443.
  // Checks the client IP against the shared allowlist before proxying to the loopback server.
  let outerServer: ReturnType<typeof serve>;
  try {
    outerServer = serve({
      port: 443,
      async fetch(req, server) {
        const requestStartTime = Date.now();
        const requestURL = new URL(req.url);
        const userAgent = req.headers.get('user-agent');
        const referer = req.headers.get('referer');
        const ip = server.requestIP(req);
        const clientIpAddress = ip ? `${ip.family}/${ip.address}` : 'unknown';
        let statusCode = 500;
        if (!ip || !AllowedIP.equals(ip)) {
          const redirectResponse = createAccessDeniedRedirectResponse(requestURL);
          statusCode = redirectResponse.status;
          errorLogger.write({
            event: 'console_access_denied',
            clientIp: clientIpAddress,
            allowedIp: AllowedIP.toString(),
            method: req.method,
            path: requestURL.pathname,
            query: requestURL.search,
            userAgent,
            referer,
          });
          accessLogger.write({
            event: 'console_access',
            clientIp: clientIpAddress,
            method: req.method,
            path: requestURL.pathname,
            query: requestURL.search,
            status: statusCode,
            responseTimeMs: Date.now() - requestStartTime,
            userAgent,
            referer,
          });
          console.error(`got ${clientIpAddress}, want ${AllowedIP.toString()}`);
          return redirectResponse;
        }

        try {
          // Proxy to the loopback console server, which handles HTML bundling and routing.
            const proxyURL = new URL(req.url);
            proxyURL.protocol = 'http:';
            proxyURL.hostname = '127.0.0.1';
            proxyURL.port = String(loopbackConsolePort);

            // If this is an incoming WebSocket upgrade, proxy the upgrade by
            // accepting the client's WebSocket and creating a client WebSocket
            // to the loopback server, then bridge messages between them. Using
            // `fetch` here cannot proxy WebSocket upgrade handshakes.
            const upgradeHeader = (req.headers.get('upgrade') || '').toLowerCase();
            if (upgradeHeader === 'websocket') {
              try {
                const wsPath = `${proxyURL.pathname}${proxyURL.search}`;
                const loopbackWsUrl = `ws://127.0.0.1:${loopbackConsolePort}${wsPath}`;
                const upgraded = (Bun as any).upgradeWebSocket(req, {
                  open(clientWs: any) {
                    try {
                      const protocolsHeader = req.headers.get('sec-websocket-protocol');
                      const protocols = protocolsHeader ? protocolsHeader.split(',').map((s) => s.trim()) : undefined;
                      const target = protocols ? new WebSocket(loopbackWsUrl, protocols) : new WebSocket(loopbackWsUrl);

                      target.binaryType = 'arraybuffer';

                      target.onopen = () => {
                        // noop
                      };

                      target.onmessage = (ev: any) => {
                        try { clientWs.send(ev.data); } catch {}
                      };

                      target.onclose = () => { try { clientWs.close(); } catch {} };
                      target.onerror = () => { try { clientWs.close(); } catch {} };

                      clientWs.onmessage = (ev: any) => {
                        try { target.send(ev.data); } catch {}
                      };
                      clientWs.onclose = () => { try { target.close(); } catch {} };
                      clientWs.onerror = () => { try { target.close(); } catch {} };
                    } catch (err) {
                      try { clientWs.close(); } catch {}
                    }
                  },
                  message() {},
                  close() {},
                  error() {},
                });
                return upgraded.response;
              } catch (err) {
                statusCode = 502;
                errorLogger.write({
                  event: 'console_ws_proxy_failed',
                  clientIp: clientIpAddress,
                  method: req.method,
                  path: requestURL.pathname,
                  query: requestURL.search,
                  error: formatUnknownError(err),
                  userAgent,
                  referer,
                });
                return new Response('Bad Gateway', { status: 502 });
              }
            }

            // Strip hop-by-hop and origin-specific headers that should not be forwarded as-is.
            const proxyHeaders = new Headers(req.headers);
            proxyHeaders.delete('host');
            proxyHeaders.delete('origin');
            proxyHeaders.delete('referer');

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
            event: 'console_proxy_failed',
            clientIp: clientIpAddress,
            method: req.method,
            path: requestURL.pathname,
            query: requestURL.search,
            error: formatUnknownError(err),
            userAgent,
            referer,
          });
          return new Response('Bad Gateway', { status: 502 });
        } finally {
          accessLogger.write({
            event: 'console_access',
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
    get url() { return outerServer.url; },
    stop(closeActiveConnections?: boolean) {
      loopbackServer.stop(closeActiveConnections);
      outerServer.stop(closeActiveConnections);
    },
  };
}

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

export type AgentStateProvider = () => unknown;

export function startConsoleServer(certPath?: string, keyPath?: string): ConsoleServer;
export function startConsoleServer(getAgentState: AgentStateProvider, certPath?: string, keyPath?: string): ConsoleServer;
export function startConsoleServer(
  arg1?: string | AgentStateProvider,
  arg2?: string,
  arg3?: string,
): ConsoleServer {
  if (typeof arg1 === "function") {
    return startConsoleServerImpl(arg1, arg2 ?? consoleCertPath, arg3 ?? consoleKeyPath);
  }
  return startConsoleServerImpl(() => ({}), arg1 ?? consoleCertPath, arg2 ?? consoleKeyPath);
}

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
 * Start the console server implementation.
 *
 * Internally uses two servers:
 * - A loopback server that serves all console routes (including HTML bundling) on 127.0.0.1.
 * - An outer server on port 443 that enforces IP allowlist and proxies permitted requests to the loopback server.
 *
 * The returned handle exposes only the outer server's URL and a unified `stop()` method.
 *
 * @param getAgentState - Provider that returns the current agent state payload for WebSocket broadcasts.
 * @param certPath - Path to the TLS certificate file.
 * @param keyPath - Path to the TLS private key file.
 */
function startConsoleServerImpl(
  getAgentState: AgentStateProvider,
  certPath: string,
  keyPath: string,
): ConsoleServer {
  // Fail fast if TLS cert/key files are missing before starting any servers.
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    throw new Error(
      `TLS certificate files not found at the resolved paths. ` +
      `certPath=${JSON.stringify(certPath)}, keyPath=${JSON.stringify(keyPath)}. ` +
      `Provide valid certPath/keyPath arguments or set CONSOLE_TLS_CERT and CONSOLE_TLS_KEY env vars to the correct paths.`
    );
  }

  const accessLogger = createDailyRotatingJsonLogger(consoleAccessLogPath);
  const errorLogger = createDailyRotatingJsonLogger(consoleErrorLogPath);
  const consoleWebSocketPath = `${consoleBasePath}api/ws`;
  const webSocketClients = new Set<WebSocket>();
  let lastWebSocketAgentStatePayload = "";
  const agentStateBroadcastInterval = setInterval(() => {
    if (webSocketClients.size === 0) {
      return;
    }
    const serializedState = JSON.stringify(getAgentState());
    if (serializedState === lastWebSocketAgentStatePayload) {
      return;
    }
    lastWebSocketAgentStatePayload = serializedState;
    for (const client of webSocketClients) {
      try {
        client.send(serializedState);
      } catch {
        webSocketClients.delete(client);
      }
    }
  }, 1_000);

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

          // Strip hop-by-hop and origin-specific headers that should not be forwarded as-is.
          const proxyHeaders = new Headers(req.headers);
          proxyHeaders.delete('host');
          proxyHeaders.delete('origin');
          proxyHeaders.delete('referer');

          if (requestURL.pathname === consoleWebSocketPath && req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
            statusCode = 101;
            const WebSocketPairConstructor = (globalThis as unknown as { WebSocketPair?: new () => unknown }).WebSocketPair;
            if (WebSocketPairConstructor === undefined) {
              throw new Error("WebSocketPair is not available in this runtime");
            }
            const webSocketPair = new WebSocketPairConstructor() as { [index: number]: any };
            const serverSocket = webSocketPair[1];
            if (!serverSocket) {
              throw new Error("WebSocketPair did not provide a server socket");
            }
            serverSocket.accept();
            serverSocket.addEventListener('open', () => {
              webSocketClients.add(serverSocket);
              try {
                serverSocket.send(JSON.stringify(getAgentState()));
              } catch {
                // intentionally ignored
              }
            });
            serverSocket.addEventListener('message', () => {
              // no-op for client subscriptions
            });
            serverSocket.addEventListener('close', () => {
              webSocketClients.delete(serverSocket);
            });
            serverSocket.addEventListener('error', () => {
              webSocketClients.delete(serverSocket);
            });
            return new Response(null, { status: 101, webSocket: webSocketPair[0] } as any);
          }

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
      clearInterval(agentStateBroadcastInterval);
      for (const client of webSocketClients) {
        client.close();
      }
      loopbackServer.stop(closeActiveConnections);
      outerServer.stop(closeActiveConnections);
    },
  };
}

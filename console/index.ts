import { serve } from "bun";
import { existsSync } from "node:fs";
import { AllowedIP } from "../lib/allowedIP";
import * as consoleRoutes from "../routes/console/index";

const consoleCertPath = process.env.CONSOLE_TLS_CERT ?? '/etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/fullchain.pem';
const consoleKeyPath = process.env.CONSOLE_TLS_KEY ?? '/etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/privkey.pem';
const consoleRedirectURL = process.env.CONSOLE_REDIRECT_URL ?? 'https://live.nicovideo.jp/watch/user/14171889';

export type ConsoleServer = {
  readonly url: URL;
  stop(closeActiveConnections?: boolean): void;
};

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
  // Fail fast if TLS cert/key files are missing before starting any servers.
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    throw new Error(
      `TLS certificate files not found at the resolved paths. ` +
      `certPath=${JSON.stringify(certPath)}, keyPath=${JSON.stringify(keyPath)}. ` +
      `Provide valid certPath/keyPath arguments or set CONSOLE_TLS_CERT and CONSOLE_TLS_KEY env vars to the correct paths.`
    );
  }

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
        const ip = server.requestIP(req);
        if (!ip || !AllowedIP.equals(ip)) {
          console.error(`got ${ip ? `${ip.family}/${ip.address}` : 'unknown'}, want ${AllowedIP.toString()}`);
          return Response.redirect(consoleRedirectURL, 302);
        }

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

        return fetch(proxyURL.toString(), {
          method: req.method,
          headers: proxyHeaders,
          body: req.body,
        });
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

import { serve } from "bun";
import { isIPAllowed } from "../lib/allowedIP";
import * as consoleRoutes from "../routes/console/index";

const consoleCertPath = process.env.CONSOLE_TLS_CERT ?? '/etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/fullchain.pem';
const consoleKeyPath = process.env.CONSOLE_TLS_KEY ?? '/etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/privkey.pem';
const consoleRedirectURL = process.env.CONSOLE_REDIRECT_URL ?? 'https://live.nicovideo.jp/watch/user/14171889';

export type ConsoleServers = {
  loopbackServer: ReturnType<typeof serve>;
  outerServer: ReturnType<typeof serve>;
};

/**
 * Start the console servers.
 *
 * Two servers are used:
 * - A loopback server that serves all console routes (including HTML bundling) on 127.0.0.1.
 * - An outer server on port 443 that enforces IP allowlist and proxies permitted requests to the loopback server.
 */
export function startConsoleServers(): ConsoleServers {
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
  const outerServer = serve({
    port: 443,
    async fetch(req, server) {
      const ip = server.requestIP(req);
      if (!isIPAllowed(ip)) {
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
      cert: Bun.file(consoleCertPath),
      key: Bun.file(consoleKeyPath),
    },
    development: process.env.NODE_ENV !== "production" && {
      // Enable browser hot reloading in development
      hmr: true,

      // Echo console logs from the browser to the server
      console: true,
    },
  });

  return { loopbackServer, outerServer };
}

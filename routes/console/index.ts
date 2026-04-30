import ConsoleApp from "../../console/src/index.html";
import {
  buildProxyHeaders,
  computeProxyBase,
  computeProxyUrl,
  getUpgrader,
  performWebSocketUpgrade,
  streamUpstreamResponse
} from "../../lib/console-proxy";
import * as agentState from "./api/agent-state";
import robotsTxt from "./robots.txt";

const BROADCASTING_HOST = process.env.BROADCASTING_HOST ?? 'localhost';
const BROADCASTING_PORT = process.env.BROADCASTING_PORT ?? '7777';

try {
  console.log('[DEBUG] routes/console initializing', { BROADCASTING_HOST, BROADCASTING_PORT });
} catch {}

// helpers moved to ../../lib/console-proxy

export const routes = {
  // Proxy the console client's streaming endpoint to the broadcasting
  // server so the browser can open a same-origin EventSource/WS.
  '/console/api/ws': async (req: Request) => {
    try { console.log('[TRACE] incoming request headers ->', Object.fromEntries(req.headers)); } catch {}
    try {
      const proxyBase = computeProxyBase(req);
      const proxyUrl = computeProxyUrl(req, proxyBase);
      try { console.log('[DEBUG] /console/api/ws proxy ->', { url: proxyUrl, method: req.method, accept: req.headers.get('accept'), upgrade: req.headers.get('upgrade'), secWebSocketKey: req.headers.get('sec-websocket-key'), secWebSocketProtocol: req.headers.get('sec-websocket-protocol') }); } catch {}

      const proxyHeaders = buildProxyHeaders(req, proxyBase);

      const upgradeHeader = (req.headers.get('upgrade') || '').toLowerCase();
      const hasSecWebSocketKey = !!req.headers.get('sec-websocket-key');
      if (upgradeHeader === 'websocket' || hasSecWebSocketKey) {
        const upstreamUrlObj = new URL(proxyUrl);
        upstreamUrlObj.protocol = upstreamUrlObj.protocol === 'https:' ? 'wss:' : 'ws:';
        if (upstreamUrlObj.hostname === 'localhost' || BROADCASTING_HOST === 'localhost') upstreamUrlObj.hostname = '127.0.0.1';
        const upstreamWsUrl = upstreamUrlObj.toString();
        try { console.log('[DEBUG] /console/api/ws upstream websocket url ->', upstreamWsUrl); } catch {}

        const upgrader = getUpgrader();
        if (!upgrader) {
          try { console.warn('[WARN] no upgradeWebSocket API available for websocket bridge'); } catch {}
          return new Response('websocket upgrade unavailable', { status: 501 });
        }

        try { console.log('[DEBUG] invoking upgrader for client request'); } catch {}
        const upgraded = await performWebSocketUpgrade(req, upgrader, proxyBase).catch((err) => {
          try { console.warn('[ERROR] upgrader threw', String(err)); } catch {}
          return null;
        });

        try { console.log('[DEBUG] upgrader invoked, upgraded ->', upgraded && (upgraded.response || upgraded)); } catch {}
        try {
          if (upgraded && (upgraded instanceof Response)) {
            return upgraded;
          }
          if (upgraded && upgraded.response) {
            return upgraded.response;
          }
        } catch (err) {
          try { console.warn('[ERROR] failed to return upgraded response', String(err)); } catch {}
        }

        return new Response('upgrade failed', { status: 500 });
      }

      // Non-upgrade: for HEAD requests upstream may omit body headers,
      // so probe with GET and return the same headers for HEAD to ensure
      // callers (tests) observe the expected Content-Type.
      if ((req.method || 'GET').toUpperCase() === 'HEAD') {
        const upstreamGet = await fetch(proxyUrl.toString(), {
          method: 'GET',
          headers: proxyHeaders,
        });
        const responseHeaders = new Headers(upstreamGet.headers);
        // Ensure cache-control for SSE
        if ((upstreamGet.headers.get('content-type') || '').includes('text/event-stream')) {
          responseHeaders.set('cache-control', 'no-cache');
        }
        return new Response(null, { status: upstreamGet.status, headers: responseHeaders });
      }

      // Non-upgrade: proxy via fetch and rewrap SSE bodies when needed
      const proxied = await fetch(proxyUrl.toString(), {
        method: req.method,
        headers: proxyHeaders,
        body: req.body,
      });

      try { console.log('[DEBUG] /console/api/ws upstream response ->', { status: proxied.status, contentType: proxied.headers.get('content-type') }); } catch {}

      const contentType = proxied.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) {
        return streamUpstreamResponse(proxied);
      }

      return proxied;
    } catch (err) {
      return new Response('proxy failed', { status: 502 });
    }
  },
  
  '/console/*': ConsoleApp,
  '/console/robots.txt': robotsTxt,
  '/console/api/agent-state': agentState,
};

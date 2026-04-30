import ConsoleApp from "../../console/src/index.html";
import {
  buildProxyHeaders,
  computeProxyBase,
  computeProxyUrl,
  getUpgrader,
  performWebSocketUpgrade,
  streamUpstreamResponse,
  proxyConsoleApiWsRequest,
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
        return await proxyConsoleUpgrade(req, proxyUrl, proxyBase);
      }

      // Delegate HEAD and proxy fetch handling to helper
      return await proxyConsoleApiWsRequest(req, proxyUrl, proxyHeaders);
    } catch (err) {
      return new Response('proxy failed', { status: 502 });
    }
  },
  
  '/console/*': ConsoleApp,
  '/console/robots.txt': robotsTxt,
  '/console/api/agent-state': agentState,
};

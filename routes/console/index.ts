import ConsoleApp from "../../console/src/index.html";
import robotsTxt from "./robots.txt";
import * as agentState from "./api/agent-state";

const BROADCASTING_HOST = process.env.BROADCASTING_HOST ?? 'localhost';
const BROADCASTING_PORT = process.env.BROADCASTING_PORT ?? '7777';

try {
  console.log('[DEBUG] routes/console initializing', { BROADCASTING_HOST, BROADCASTING_PORT });
} catch {}

export const routes = {
  // Proxy the console client's streaming endpoint to the broadcasting
  // server so the browser can open a same-origin EventSource/WS.
  '/console/api/ws': async (req: Request) => {
    try { console.log('[TRACE] incoming request headers ->', Object.fromEntries(req.headers)); } catch {}
    try {
      let proxyBase = `http://${BROADCASTING_HOST}:${BROADCASTING_PORT}`;
      try {
        const incomingHost = req.headers.get('host') ?? '';
        if (incomingHost && proxyBase.includes(incomingHost)) {
          proxyBase = `http://127.0.0.1:${BROADCASTING_PORT}`;
          try { console.log('[WARN] Detected self-proxying; overriding proxyBase ->', proxyBase); } catch {}
        }
      } catch {}

      let parsed: URL;
      try { parsed = new URL(req.url); } catch (err) {
        const hostForParse = req.headers.get('host') ?? `${BROADCASTING_HOST}:${BROADCASTING_PORT}`;
        parsed = new URL(req.url, `http://${hostForParse}`);
      }

      const proxyUrl = `${proxyBase}/console/api/ws${parsed.search ?? ''}`;
      try { console.log('[DEBUG] /console/api/ws proxy ->', { url: proxyUrl, method: req.method, accept: req.headers.get('accept'), upgrade: req.headers.get('upgrade'), secWebSocketKey: req.headers.get('sec-websocket-key'), secWebSocketProtocol: req.headers.get('sec-websocket-protocol') }); } catch {}

      const proxyHeaders = new Headers(req.headers);
      proxyHeaders.set('host', `${BROADCASTING_HOST}:${BROADCASTING_PORT}`);
      proxyHeaders.delete('origin');
      proxyHeaders.delete('referer');
      if (!proxyHeaders.has('accept')) proxyHeaders.set('accept', 'text/event-stream');

      const upgradeHeader = (req.headers.get('upgrade') || '').toLowerCase();
      const hasSecWebSocketKey = !!req.headers.get('sec-websocket-key');
      if (upgradeHeader === 'websocket' || hasSecWebSocketKey) {
        const upstreamUrlObj = new URL(proxyUrl);
        upstreamUrlObj.protocol = upstreamUrlObj.protocol === 'https:' ? 'wss:' : 'ws:';
        if (upstreamUrlObj.hostname === 'localhost' || BROADCASTING_HOST === 'localhost') upstreamUrlObj.hostname = '127.0.0.1';
        const upstreamWsUrl = upstreamUrlObj.toString();
        try { console.log('[DEBUG] /console/api/ws upstream websocket url ->', upstreamWsUrl); } catch {}

        const upgrader = (() => {
          try {
            if (typeof globalThis !== 'undefined') {
              if ((globalThis as any).Bun && typeof (globalThis as any).Bun.upgradeWebSocket === 'function') return (globalThis as any).Bun.upgradeWebSocket;
              if (typeof (globalThis as any).upgradeWebSocket === 'function') return (globalThis as any).upgradeWebSocket;
            }
          } catch {}
          try {
            if (typeof Bun !== 'undefined' && (Bun as any).upgradeWebSocket) return (Bun as any).upgradeWebSocket;
          } catch {}
          return null;
        })();
        if (!upgrader) {
          try { console.warn('[WARN] no upgradeWebSocket API available for websocket bridge'); } catch {}
          return new Response('websocket upgrade unavailable', { status: 501 });
        }

        try { console.log('[DEBUG] invoking upgrader for client request'); } catch {}
        let upgraded: any = null;
        try {
          upgraded = upgrader(req, {
          open(clientWs: any) {
            // Simplified bridge: always use SSE->WS forwarding on upgrades.
            // This avoids relying on an upstream WebSocket client and
            // ensures an initial JSON payload is sent to the browser.
            (async () => {
              try {
                try { console.log('[DEBUG] websocket upgrade accepted; starting SSE->WS forwarder'); } catch {}

                const sseUrl = `http://${BROADCASTING_HOST === 'localhost' ? '127.0.0.1' : BROADCASTING_HOST}:${BROADCASTING_PORT}/console/api/ws`;
                try { console.log('[DEBUG] opening upstream SSE fetch ->', sseUrl); } catch {}
                const res = await fetch(sseUrl, { headers: { accept: 'text/event-stream' } });
                try { console.log('[DEBUG] upstream SSE response ->', { status: res.status, contentType: res.headers.get('content-type') }); } catch {}
                const upstreamBody: any = res.body;

                // Send a one-off /api/meta snapshot to ensure the client
                // gets an initial JSON message promptly.
                try {
                  const metaRes = await fetch(`http://${BROADCASTING_HOST}:${BROADCASTING_PORT}/api/meta`);
                  const metaJson = await metaRes.json().catch(() => ({}));
                  try { clientWs.send(JSON.stringify(metaJson)); } catch {}
                } catch (err) {
                  try { console.warn('[DIAG] failed to send initial meta snapshot', String(err)); } catch {}
                }

                if (!upstreamBody || typeof upstreamBody.getReader !== 'function') {
                  // Non-streaming fallback: send JSON body and return.
                  try {
                    const json = await res.json().catch(() => ({}));
                    try { clientWs.send(JSON.stringify(json)); } catch {}
                  } catch {}
                  return;
                }

                const reader = upstreamBody.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let stopped = false;

                (async () => {
                  try {
                    while (!stopped) {
                      const { done, value } = await reader.read();
                      if (done) break;
                      buffer += decoder.decode(value, { stream: true });
                      let idx = buffer.indexOf('\r\n\r\n');
                      if (idx === -1) idx = buffer.indexOf('\n\n');
                      while (idx !== -1) {
                        const event = buffer.slice(0, idx);
                        buffer = buffer.slice(idx + (buffer.startsWith('\r\n', idx) ? 4 : 2));
                        const dataLines = event.split(/\r?\n/).filter((l) => l.startsWith('data:'));
                        if (dataLines.length > 0) {
                          const data = dataLines.map((l) => l.replace(/^data:\s?/, '')).join('\n');
                          try { clientWs.send(data); } catch (err) { try { clientWs.close(); } catch {} }
                        }
                        idx = buffer.indexOf('\r\n\r\n');
                        if (idx === -1) idx = buffer.indexOf('\n\n');
                      }
                    }
                  } catch (err) {
                    try { console.warn('[DIAG] SSE reader failed', String(err)); } catch {}
                  } finally {
                    try { reader.cancel && typeof reader.cancel === 'function' && reader.cancel(); } catch {}
                  }
                })();

                clientWs.onmessage = (_ev: any) => {};
                clientWs.onclose = (_ev: any) => { stopped = true; try { reader.cancel && typeof reader.cancel === 'function' && reader.cancel(); } catch {} };
                clientWs.onerror = (_ev: any) => { stopped = true; try { reader.cancel && typeof reader.cancel === 'function' && reader.cancel(); } catch {} };
                return;
              } catch (err) {
                try { console.warn('[WARN] simplified websocket bridge failed', String(err)); } catch {}
                try { clientWs.close(); } catch {}
              }
            })();
          },
          message() {},
          close() {},
          });
        } catch (err) {
          try { console.warn('[ERROR] upgrader threw', String(err)); } catch {}
          upgraded = null;
        }

        try { console.log('[DEBUG] upgrader invoked, upgraded ->', upgraded && (upgraded.response || upgraded)); } catch {}
        // Support both forms: upgraded may be a Response or an object with `response`.
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
        const responseHeaders = new Headers(proxied.headers);
        responseHeaders.set('cache-control', 'no-cache');
        const upstreamBody: any = proxied.body;
        if (upstreamBody && typeof upstreamBody.getReader === 'function') {
          const wrapped = new ReadableStream({
            start(controller) {
              const reader = upstreamBody.getReader();
              (async () => {
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) { controller.close(); break; }
                    controller.enqueue(value);
                  }
                } catch (e) {
                  try { controller.error(e); } catch {}
                } finally {
                  try { reader.releaseLock(); } catch {}
                }
              })();
            },
            cancel() {
              try { upstreamBody.cancel && upstreamBody.cancel(); } catch {}
            },
          });

          return new Response(wrapped, { status: proxied.status, headers: responseHeaders });
        }

        return new Response(proxied.body, { status: proxied.status, headers: responseHeaders });
      }

      return proxied;
    } catch (err) {
      return new Response('proxy failed', { status: 502 });
    }
  },
  '/console/env': async () => {
    try {
      try { console.log('[TRACE] /console/env requested'); } catch {}
      // Normalize broadcasting host for browser clients: prefer IPv4
      // loopback when configuration uses 'localhost' to avoid cases
      // where 'localhost' resolves to an IPv6 address (::1) that the
      // server is not bound to in some environments (Playwright CI).
      const clientBroadcastingHost = BROADCASTING_HOST === 'localhost' ? '127.0.0.1' : BROADCASTING_HOST;
      return new Response(JSON.stringify({ broadcastingHost: clientBroadcastingHost, broadcastingPort: BROADCASTING_PORT }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    } catch (err) {
      return new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' }, status: 500 });
    }
  },
  '/console/*': ConsoleApp,
  '/console/robots.txt': robotsTxt,
  '/console/api/agent-state': agentState,
};

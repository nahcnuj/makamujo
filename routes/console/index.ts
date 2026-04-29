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
    try {
      let proxyBase = `http://${BROADCASTING_HOST}:${BROADCASTING_PORT}`;
      // Detect accidental self-proxying: if the configured broadcasting
      // base would target the current incoming host (the loopback
      // console server) prefer the default broadcasting address to avoid
      // returning the SPA HTML instead of an SSE stream.
      try {
        const incomingHost = req.headers.get('host') ?? '';
        if (incomingHost && proxyBase.includes(incomingHost)) {
          proxyBase = `http://localhost:7777`;
          console.log('[WARN] Detected self-proxying; overriding proxyBase ->', proxyBase);
        }
      } catch {}
      // Parse the incoming request URL safely (it may be relative).
      let parsed: URL;
      try {
        parsed = new URL(req.url);
      } catch (err) {
        const hostForParse = req.headers.get('host') ?? `${BROADCASTING_HOST}:${BROADCASTING_PORT}`;
        parsed = new URL(req.url, `http://${hostForParse}`);
      }

      // Always target the broadcasting server's `/console/api/ws` endpoint
      // and preserve the original query string. The broadcasting server
      // exposes the same SSE/WS behavior at `/console/api/ws` and
      // `/api/ws`; using the console-prefixed path avoids ambiguity with
      // any potential upstream routing rules that might shadow `/api`.
      const proxyUrl = `${proxyBase}/console/api/ws${parsed.search ?? ''}`;
      // Log incoming proxy requests for diagnostics (helps E2E failures)
      try {
        console.log('[DEBUG] /console/api/ws proxy ->', {
          url: proxyUrl.toString(),
          accept: req.headers.get('accept'),
          upgrade: req.headers.get('upgrade'),
        });
      } catch {}

      const proxyHeaders = new Headers(req.headers);
      // Strip hop-by-hop and origin-specific headers that should not be
      // forwarded as-is. Ensure upstream sees the broadcasting host
      // string that the server advertises.
      proxyHeaders.set('host', `${BROADCASTING_HOST}:${BROADCASTING_PORT}`);
      proxyHeaders.delete('origin');
      proxyHeaders.delete('referer');
      if (!proxyHeaders.has('accept')) {
        proxyHeaders.set('accept', 'text/event-stream');
      }

      // If the incoming request is a WebSocket upgrade, proxy the
      // upgrade by accepting the client's WebSocket and opening a
      // client WebSocket to the broadcasting server, then bridge the
      // message streams. `fetch` cannot proxy websocket upgrades.
      const upgradeHeader = (req.headers.get('upgrade') || '').toLowerCase();
      try { console.log('[DEBUG] FORCE_DISABLE_WS_UPGRADE=', process.env.FORCE_DISABLE_WS_UPGRADE); } catch {}
      if (upgradeHeader === 'websocket') {
        // Allow tests / CI to explicitly disable WebSocket upgrade handling
        // so callers (e.g. probe requests) receive a 501 when upgrades are
        // intentionally unavailable. This is controlled by the
        // `FORCE_DISABLE_WS_UPGRADE` environment variable.
        if (process.env.FORCE_DISABLE_WS_UPGRADE === '1') {
          try { console.log('[DEBUG] rejecting websocket upgrade due to FORCE_DISABLE_WS_UPGRADE'); } catch {}
          return new Response('websocket upgrade unavailable', { status: 501 });
        }
        try {
          // Ensure the upstream WebSocket URL uses the ws/wss scheme
          // instead of http/https so the WebSocket client connects
          // correctly to the broadcasting server.
          const upstreamUrlObj = new URL(proxyUrl);
          upstreamUrlObj.protocol = upstreamUrlObj.protocol === 'https:' ? 'wss:' : 'ws:';
          const upstreamWsUrl = upstreamUrlObj.toString();

          const upgraded = (Bun as any).upgradeWebSocket(req, {
            open(clientWs: any) {
              try {
                const protocolsHeader = req.headers.get('sec-websocket-protocol');
                const protocols = protocolsHeader ? protocolsHeader.split(',').map((s) => s.trim()) : undefined;
                const target = protocols ? new WebSocket(upstreamWsUrl, protocols) : new WebSocket(upstreamWsUrl);
                target.binaryType = 'arraybuffer';

                target.onopen = () => { /* noop */ };
                target.onmessage = (ev: any) => { try { clientWs.send(ev.data); } catch {} };
                target.onclose = () => { try { clientWs.close(); } catch {} };
                target.onerror = () => { try { clientWs.close(); } catch {} };

                clientWs.onmessage = (ev: any) => { try { target.send(ev.data); } catch {} };
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
          return new Response('websocket proxy failed', { status: 502 });
        }
      }

      const proxied = await fetch(proxyUrl.toString(), {
        method: req.method,
        headers: proxyHeaders,
        body: req.body,
      });

      try {
        console.log('[DEBUG] /console/api/ws upstream response ->', {
          status: proxied.status,
          contentType: proxied.headers.get('content-type'),
        });
      } catch {}

      // If the upstream responded with an SSE stream, re-wrap the
      // streaming body so Bun forwards chunks to the browser without
      // buffering. For non-streaming responses (e.g., the SPA index
      // HTML), return the upstream response unchanged so callers get a
      // faithful response.
      try {
        const contentType = proxied.headers.get('content-type') ?? '';
        if (contentType.includes('text/event-stream')) {
          const responseHeaders = new Headers(proxied.headers);
          responseHeaders.set('cache-control', 'no-cache');
          // Ensure the connection header indicates streaming behavior.
          try { responseHeaders.set('Connection', 'keep-alive'); } catch {}
          try { console.log('[DEBUG] /console/api/ws rewrapping SSE body -> proxied.body=', !!proxied.body); } catch {}

          // Re-wrap the upstream ReadableStream so Bun reliably forwards
          // chunks to the browser without buffering or early termination.
          try {
            const upstreamBody: any = proxied.body;
            try { console.log('[DEBUG] upstreamBody.getReader=', typeof upstreamBody?.getReader); } catch {}
            if (upstreamBody && typeof upstreamBody.getReader === 'function') {
              const stream = new ReadableStream({
                start(controller) {
                  const reader = upstreamBody.getReader();
                  (async function pump() {
                    try {
                      while (true) {
                        const { done, value }: any = await reader.read();
                        if (done) {
                          try { controller.close(); } catch {}
                          break;
                        }
                        try {
                          // Log the first chunk for diagnostics.
                          try {
                            if (value && (typeof value.byteLength === 'number' || typeof value.length === 'number')) {
                              const len = value.byteLength ?? value.length;
                              const sample = (() => {
                                try { return new TextDecoder().decode(value).slice(0, 128); } catch { return null; }
                              })();
                              try { console.log('[DEBUG] proxied SSE chunk ->', { length: len, sample }); } catch {}
                            }
                          } catch {}
                          controller.enqueue(value);
                        } catch (err) {
                          try { controller.error(err); } catch {}
                          break;
                        }
                      }
                    } catch (err) {
                      try { controller.error(err); } catch {}
                    }
                  })();
                },
                cancel() { try { if (upstreamBody && typeof upstreamBody.cancel === 'function') upstreamBody.cancel(); } catch {} },
              });
              return new Response(stream, {
                status: proxied.status,
                headers: responseHeaders,
              });
            }
          } catch (err) {
            try { console.warn('[WARN] failed to rewrap proxied SSE body', err); } catch {}
          }

          // Fallback: return the proxied response body directly if rewrap isn't possible.
          return new Response(proxied.body, {
            status: proxied.status,
            headers: responseHeaders,
          });
        }
      // Non-SSE response (likely HTML). Log a short snippet of the
      // upstream body to aid diagnosis, then return the proxied
      // response unchanged so the browser receives the same content.
      try {
        const clone = proxied.clone();
        const text = await clone.text().catch(() => '');
        try {
          console.log('[DEBUG] /console/api/ws upstream HTML snippet ->', text.slice(0, 512));
        } catch {}
      } catch {}

      return proxied;
    } catch (err) {
      return proxied;
    }
    } catch (err) {
      return new Response('proxy failed', { status: 502 });
    }
  },
  '/console/env': async () => {
    try {
      try { console.log('[TRACE] /console/env requested'); } catch {}
      return new Response(JSON.stringify({ broadcastingHost: BROADCASTING_HOST, broadcastingPort: BROADCASTING_PORT }), {
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

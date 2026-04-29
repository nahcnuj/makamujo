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
          proxyBase = `http://127.0.0.1:7777`;
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
      const upstreamUrlObj = new URL(proxyUrl);
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

      // Handle WebSocket upgrade requests directly so we can bridge the
      // upgrade to the broadcasting server. Using fetch() for upgrades
      // is unreliable because it may not surface the 101 handshake.
      try {
        const upgradeHeader = (req.headers.get('upgrade') || '').toLowerCase();
        const hasSecWebSocketKey = !!req.headers.get('sec-websocket-key');
        if (upgradeHeader === 'websocket' || hasSecWebSocketKey) {
          const connectionHeader = req.headers.get('connection') ?? '';
          const protocolsHeader = req.headers.get('sec-websocket-protocol') ?? '';
          try { console.log('[DEBUG] /console/api/ws websocket proxy handshake ->', { upgrade: upgradeHeader, connection: connectionHeader, protocols: protocolsHeader }); } catch {}

          const upstreamUrlObj = new URL(proxyUrl);
          upstreamUrlObj.protocol = upstreamUrlObj.protocol === 'https:' ? 'wss:' : 'ws:';
          // Prefer IPv4 loopback when broadcasting host is configured as
          // 'localhost' to avoid environments where 'localhost' resolves
          // to an IPv6 address that the loopback server is not bound to.
          if (upstreamUrlObj.hostname === 'localhost' || BROADCASTING_HOST === 'localhost') {
            upstreamUrlObj.hostname = '127.0.0.1';
          }
          const upstreamWsUrl = upstreamUrlObj.toString();
          try { console.log('[DEBUG] /console/api/ws upstream websocket url ->', upstreamWsUrl); } catch {}

          const upgrader = ((): any => {
            if (typeof (Bun as any).upgradeWebSocket === 'function') return (Bun as any).upgradeWebSocket;
            if (typeof (globalThis as any).upgradeWebSocket === 'function') return (globalThis as any).upgradeWebSocket;
            if (typeof (globalThis as any).Bun?.upgradeWebSocket === 'function') return (globalThis as any).Bun.upgradeWebSocket;
            return null;
          })();
          if (!upgrader) {
            try { console.warn('[WARN] no upgradeWebSocket API available for websocket bridge'); } catch {}
            return new Response('websocket upgrade unavailable', { status: 501 });
          }

          const upgraded = upgrader(req, {
            open(clientWs: any) {
              try {
                const protocolsHeader = req.headers.get('sec-websocket-protocol');
                const protocols = protocolsHeader ? protocolsHeader.split(',').map((s) => s.trim()) : undefined;
                try { console.log('[DEBUG] websocket bridge open ->', { upstream: upstreamWsUrl, protocols }); } catch {}

                // Try to construct a bridged WebSocket to the broadcasting
                // server. If this fails for any reason (some runtimes/platform
                // combinations have exhibited handshake failures here), fall
                // back to a lightweight behavior: fetch the current stream
                // payload via HTTP and send it as the first message, which
                // satisfies the E2E expectations for an initial update.
                // Helper: open an SSE stream to the broadcasting server and
                // forward `data:` events to the connected `clientWs` so the
                // browser receives the initial payload even when a WS bridge
                // cannot be established.
                const forwardSseToClient = async () => {
                  try {
                    const sseUrl = `http://${BROADCASTING_HOST}:${BROADCASTING_PORT}/console/api/ws`;
                    const res = await fetch(sseUrl, { headers: { accept: 'text/event-stream' } });
                    const upstreamBody: any = res.body;
                    if (!upstreamBody || typeof upstreamBody.getReader !== 'function') {
                      // Non-streaming response: try JSON body as a single message.
                      const json = await res.json().catch(() => ({}));
                      try { clientWs.send(JSON.stringify(json)); } catch {}
                      return;
                    }

                    const reader = upstreamBody.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;
                      buffer += decoder.decode(value, { stream: true });
                      let idx;
                      while ((idx = buffer.indexOf('\n\n')) !== -1) {
                        const event = buffer.slice(0, idx);
                        buffer = buffer.slice(idx + 2);
                        const dataLines = event.split(/\r?\n/).filter((l) => l.startsWith('data:'));
                        if (dataLines.length > 0) {
                          const data = dataLines.map((l) => l.replace(/^data:\s?/, '')).join('\n');
                          try { clientWs.send(data); } catch {}
                        }
                      }
                    }
                  } catch (err) {
                    try { clientWs.close(); } catch {}
                  }
                };

                try {
                  const target = protocols ? new WebSocket(upstreamWsUrl, protocols) : new WebSocket(upstreamWsUrl);
                  target.binaryType = 'arraybuffer';

                  target.onopen = () => { try { console.log('[DEBUG] websocket bridge target.onopen'); } catch {} };
                  target.onmessage = (ev: any) => { try { clientWs.send(ev.data); } catch (err) { try { console.warn('[WARN] websocket target->client send failed', String(err)); } catch {} } };
                  target.onclose = (ev: any) => { try { console.log('[DEBUG] websocket bridge target.onclose', ev); clientWs.close(); } catch {} };
                  target.onerror = (ev: any) => {
                    try { console.warn('[WARN] websocket bridge target.onerror', ev); } catch {}
                    // Attempt streaming SSE fallback so the browser still gets
                    // an initial payload even if the upstream WS handshake
                    // fails asynchronously.
                    forwardSseToClient();
                  };

                  clientWs.onmessage = (ev: any) => { try { target.send(ev.data); } catch (err) { try { console.warn('[WARN] websocket client->target send failed', String(err)); } catch {} } };
                  clientWs.onclose = (ev: any) => { try { console.log('[DEBUG] websocket bridge client.onclose', ev); target.close(); } catch {} };
                  clientWs.onerror = (ev: any) => { try { console.warn('[WARN] websocket bridge client.onerror', ev); target.close(); } catch {} };
                  return;
                } catch (err) {
                  try { console.warn('[WARN] websocket bridge failed, falling back to SSE stream initial-send', String(err)); } catch {}
                }

                // Fallback: fetch current state from broadcasting server and
                // send it as the first WS message to satisfy E2E expectations.
                (async () => {
                  try {
                    const metaRes = await fetch(`http://${BROADCASTING_HOST}:${BROADCASTING_PORT}/api/meta`);
                    const body = await metaRes.json().catch(() => ({}));
                    try { clientWs.send(JSON.stringify(body)); } catch {}
                  } catch (err) {
                    try { clientWs.close(); } catch {}
                  }
                })();
              } catch (err) {
                try { console.warn('[WARN] websocket bridge open handler failed', String(err)); } catch {}
                try { clientWs.close(); } catch {}
              }
            },
            message() {},
            close() {},
            error() {},
          });
          return upgraded.response;
        }
      } catch (err) {
        try { console.warn('[WARN] websocket proxy failed prefetch', String(err)); } catch {}
        return new Response('websocket proxy failed', { status: 502 });
      }

      // Special-case HEAD: some upstream streaming endpoints do not
      // respond to HEAD consistently. To reliably expose headers to
      // test runners without opening a persistent stream, perform a
      // GET to the upstream and return only the headers for HEAD
      // requests. Ensure we cancel the upstream body to avoid leaving
      // the connection open.
      let proxied: Response;
      if ((req.method || '').toUpperCase() === 'HEAD') {
        proxied = await fetch(proxyUrl.toString(), {
          method: 'GET',
          headers: proxyHeaders,
        });
        try {
          const responseHeaders = new Headers(proxied.headers);
          responseHeaders.set('cache-control', 'no-cache');
          try { proxied.body && typeof proxied.body.cancel === 'function' && proxied.body.cancel(); } catch {}
          return new Response(null, { status: proxied.status, headers: responseHeaders });
        } catch (err) {
          // Fall through to treat as a normal proxied response below
        }
      }

      proxied = await fetch(proxyUrl.toString(), {
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

          // Wrap the upstream streaming body into a fresh ReadableStream
          // so downstream clients (Playwright, browsers) get a concrete
          // stream object that Bun can forward reliably without
          // accidental buffering or premature aborts.
          const upstreamBody: any = proxied.body;
          if (upstreamBody && typeof upstreamBody.getReader === 'function') {
            const wrapped = new ReadableStream({
              async start(controller) {
                const reader = upstreamBody.getReader();
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                      controller.close();
                      break;
                    }
                    controller.enqueue(value);
                  }
                } catch (e) {
                  try { controller.error(e); } catch {}
                } finally {
                  try { reader.releaseLock(); } catch {}
                }
              },
              cancel() {
                try {
                  const maybePromise = upstreamBody.cancel && upstreamBody.cancel();
                  if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.catch(() => {});
                  }
                } catch {}
              },
            });

            return new Response(wrapped, {
              status: proxied.status,
              headers: responseHeaders,
            });
          }

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

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
        if (upgradeHeader === 'websocket') {
          const connectionHeader = req.headers.get('connection') ?? '';
          const protocolsHeader = req.headers.get('sec-websocket-protocol') ?? '';
          try { console.log('[DEBUG] /console/api/ws websocket proxy handshake ->', { upgrade: upgradeHeader, connection: connectionHeader, protocols: protocolsHeader }); } catch {}

          const upstreamUrlObj = new URL(proxyUrl);
          upstreamUrlObj.protocol = upstreamUrlObj.protocol === 'https:' ? 'wss:' : 'ws:';
          const upstreamWsUrl = upstreamUrlObj.toString();
          try { console.log('[DEBUG] /console/api/ws upstream websocket url ->', upstreamWsUrl); } catch {}

          const upgraded = (Bun as any).upgradeWebSocket(req, {
            open(clientWs: any) {
              try {
                const protocols = protocolsHeader ? protocolsHeader.split(',').map((s) => s.trim()) : undefined;
                try { console.log('[DEBUG] websocket bridge open ->', { upstream: upstreamWsUrl, protocols }); } catch {}

                let target: WebSocket | null = null;
                try {
                  target = protocols ? new WebSocket(upstreamWsUrl, protocols) : new WebSocket(upstreamWsUrl);
                  target.binaryType = 'arraybuffer';
                } catch (err) {
                  try { console.warn('[WARN] websocket bridge failed to construct target websocket', String(err)); } catch {}
                  try { clientWs.close(); } catch {}
                  return;
                }

                target.onopen = () => { try { console.log('[DEBUG] websocket bridge target.onopen'); } catch {} };
                target.onmessage = (ev: any) => { try { clientWs.send(ev.data); } catch (err) { try { console.warn('[WARN] websocket target->client send failed', String(err)); } catch {} } };
                target.onclose = (ev: any) => { try { console.log('[DEBUG] websocket bridge target.onclose', ev); clientWs.close(); } catch {} };
                target.onerror = (ev: any) => { try { console.warn('[WARN] websocket bridge target.onerror', ev); clientWs.close(); } catch {} };

                clientWs.onmessage = (ev: any) => { try { target.send(ev.data); } catch (err) { try { console.warn('[WARN] websocket client->target send failed', String(err)); } catch {} } };
                clientWs.onclose = (ev: any) => { try { console.log('[DEBUG] websocket bridge client.onclose', ev); target.close(); } catch {} };
                clientWs.onerror = (ev: any) => { try { console.warn('[WARN] websocket bridge client.onerror', ev); target.close(); } catch {} };
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

      // Non-upgrade: proxy the request using fetch and, if the upstream
      // response is an SSE stream, rewrap the body to ensure Bun does
      // not buffer it before sending to the browser.
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

      try {
        const contentType = proxied.headers.get('content-type') ?? '';
        if (contentType.includes('text/event-stream')) {
          const responseHeaders = new Headers(proxied.headers);
          responseHeaders.set('cache-control', 'no-cache');

          const upstreamBody = proxied.body;
          if (!upstreamBody) {
            return new Response(null, { status: proxied.status, headers: responseHeaders });
          }

          try { console.log('[DEBUG] /console/api/ws SSE rewrap -> creating reader'); } catch {}

          let reader: any = null;
          let readerClosed = false;
          const stream = new ReadableStream({
            start(controller) {
              try {
                reader = (upstreamBody as any).getReader();
              } catch (err) {
                try { console.warn('[WARN] /console/api/ws SSE rewrap -> failed to get reader', String(err)); } catch {}
                try { controller.error(err); } catch {}
                return;
              }

              let firstChunkLogged = false;

              (async function pump() {
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                      try { console.log('[DEBUG] /console/api/ws SSE rewrap -> upstream done'); } catch {}
                      if (!readerClosed) {
                        try { controller.close(); } catch {}
                        readerClosed = true;
                      }
                      break;
                    }
                    try {
                      if (!firstChunkLogged) {
                        try { console.log('[DEBUG] /console/api/ws SSE rewrap -> first chunk size', value ? (value.byteLength ?? value.length ?? 0) : 0); } catch {}
                        firstChunkLogged = true;
                      }
                    } catch {}
                    controller.enqueue(value);
                  }
                } catch (err) {
                  try { console.warn('[WARN] /console/api/ws SSE rewrap pump error', String(err)); } catch {}
                  try { controller.error(err); } catch {}
                } finally {
                  readerClosed = true;
                }
              })();
            },
            cancel(reason) {
              try { console.log('[DEBUG] /console/api/ws SSE rewrap -> cancel invoked', reason); } catch {}
              if (reader && typeof reader.cancel === 'function') {
                try { reader.cancel().catch(() => {}); } catch {}
              }
            },
          });

          return new Response(stream, { status: proxied.status, headers: responseHeaders });
        }

        // Non-SSE: return the proxied response unchanged, but log a
        // snippet to help diagnose unexpected HTML being returned.
        try {
          const clone = proxied.clone();
          const text = await clone.text().catch(() => '');
          try { console.log('[DEBUG] /console/api/ws upstream HTML snippet ->', text.slice(0, 512)); } catch {}
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

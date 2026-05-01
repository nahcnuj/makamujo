export function streamUpstreamResponse(proxied: Response) {
  const responseHeaders = new Headers(proxied.headers);
  responseHeaders.set('cache-control', 'no-cache');
  // Remove content-length to avoid mismatches when streaming/chunked.
  responseHeaders.delete('content-length');
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

export function getUpgrader(): ((req: Request, opts: any) => any) | null {
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
}

export async function performWebSocketUpgrade(req: Request, upgrader: any, proxyBase: string) {
  return new Promise<any>((resolve, _reject) => {
    try {
      const upgraded = upgrader(req, {
        open(clientWs: any) {
          (async () => {
            try {
              try { console.log('[DEBUG] websocket upgrade accepted; starting SSE->WS forwarder'); } catch {}
              const sseUrl = `${proxyBase}/console/api/ws`;
              try { console.log('[DEBUG] opening upstream SSE fetch ->', sseUrl); } catch {}
              const res = await fetch(sseUrl, { headers: { accept: 'text/event-stream' } });
              try { console.log('[DEBUG] upstream SSE response ->', { status: res.status, contentType: res.headers.get('content-type') }); } catch {}
              const upstreamBody: any = res.body;

              try {
                const metaJson = await fetchMetaSnapshot(proxyBase);
                try { clientWs.send(JSON.stringify(metaJson)); } catch {}
              } catch (err) {
                try { console.warn('[DIAG] failed to send initial meta snapshot', String(err)); } catch {}
              }

              if (!upstreamBody || typeof upstreamBody.getReader !== 'function') {
                try {
                  const json = await res.json().catch(() => ({}));
                  try { clientWs.send(JSON.stringify(json)); } catch {}
                } catch {}
                return;
              }

              const cancelForward = forwardSSEEventsToSink(upstreamBody, (data) => {
                try { clientWs.send(data); } catch (err) { try { clientWs.close(); } catch {} }
              });

              clientWs.onmessage = (_ev: any) => {};
              clientWs.onclose = (_ev: any) => { cancelForward(); };
              clientWs.onerror = (_ev: any) => { cancelForward(); };

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
      resolve(upgraded);
    } catch (err) {
      resolve(null);
    }
  });
}

export function forwardSSEEventsToSink(upstreamBody: any, sink: (data: string) => void) {
  if (!upstreamBody || typeof upstreamBody.getReader !== 'function') {
    return () => {};
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
            try { sink(data); } catch {}
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

  return () => {
    stopped = true;
    try { reader.cancel && typeof reader.cancel === 'function' && reader.cancel(); } catch {}
  };
}

export function buildProxyHeaders(req: Request, proxyBase: string) {
  const proxyHeaders = new Headers(req.headers);
  try {
    const proxyBaseHost = new URL(proxyBase).host;
    proxyHeaders.set('host', proxyBaseHost);
  } catch {
    proxyHeaders.set('host', `${process.env.BROADCASTING_HOST ?? 'localhost'}:${process.env.BROADCASTING_PORT ?? '7777'}`);
  }
  proxyHeaders.delete('origin');
  proxyHeaders.delete('referer');
  if (!proxyHeaders.has('accept')) proxyHeaders.set('accept', 'text/event-stream');
  return proxyHeaders;
}

export function computeProxyBase(req: Request) {
  const BROADCASTING_HOST = process.env.BROADCASTING_HOST ?? 'localhost';
  const BROADCASTING_PORT = process.env.BROADCASTING_PORT ?? '7777';
  let proxyBase = `http://${BROADCASTING_HOST}:${BROADCASTING_PORT}`;
  try {
    const incomingHost = req.headers.get('host') ?? '';
    if (incomingHost && proxyBase.includes(incomingHost)) {
      proxyBase = `http://127.0.0.1:${BROADCASTING_PORT}`;
      try { console.log('[WARN] Detected self-proxying; overriding proxyBase ->', proxyBase); } catch {}
    }
  } catch {}
  return proxyBase;
}

export function computeProxyUrl(req: Request, proxyBase: string) {
  let parsed: URL;
  try { parsed = new URL(req.url); } catch (err) {
    const BROADCASTING_HOST = process.env.BROADCASTING_HOST ?? 'localhost';
    const BROADCASTING_PORT = process.env.BROADCASTING_PORT ?? '7777';
    const hostForParse = req.headers.get('host') ?? `${BROADCASTING_HOST}:${BROADCASTING_PORT}`;
    parsed = new URL(req.url, `http://${hostForParse}`);
  }
  return `${proxyBase}/console/api/ws${parsed.search ?? ''}`;
}

export async function fetchMetaSnapshot(proxyBase: string): Promise<any> {
  try {
    const res = await fetch(`${proxyBase}/api/meta`);
    return await res.json().catch(() => ({}));
  } catch (err) {
    try { console.warn('[DIAG] fetchMetaSnapshot failed', String(err)); } catch {}
    return {};
  }
}

/**
 * Creates an SSE Response that stays connected even when the upstream drops.
 * When the upstream closes or errors, it automatically reconnects and continues
 * streaming. This prevents ERR_INCOMPLETE_CHUNKED_ENCODING errors in the browser
 * caused by the upstream connection dropping mid-stream.
 */
export function createResilientSseProxy(
  fetchUpstream: () => Promise<Response>,
  reconnectDelayMs = 500,
): Response {
  let stopped = false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      (async () => {
        while (!stopped) {
          let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
          try {
            const upstream = await fetchUpstream();
            const body = upstream.body as ReadableStream<Uint8Array> | null;

            if (!body || typeof (body as any).getReader !== 'function') {
              if (!stopped) {
                try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch {}
                await new Promise<void>(r => setTimeout(r, reconnectDelayMs));
              }
              continue;
            }

            reader = (body as ReadableStream<Uint8Array>).getReader();
            while (!stopped) {
              const { done, value } = await reader.read();
              if (done) break;
              try { controller.enqueue(value); } catch {}
            }
          } catch {
            // Connection failed, will retry after delay
          } finally {
            if (reader) {
              try { reader.cancel(); } catch {}
              reader = null;
            }
          }

          if (!stopped) {
            // Flush any partial SSE event in the downstream buffer with a blank
            // line, then wait before reconnecting to the upstream.
            try { controller.enqueue(encoder.encode('\n\n')); } catch {}
            await new Promise<void>(r => setTimeout(r, reconnectDelayMs));
          }
        }
        try { controller.close(); } catch {}
      })().catch(() => {
        try { controller.close(); } catch {}
      });
    },
    cancel() {
      stopped = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function proxyConsoleApiWsRequest(req: Request, proxyUrl: string, proxyHeaders: Headers): Promise<Response> {
  // HEAD handling: probe upstream with GET and return headers only
  if ((req.method || 'GET').toUpperCase() === 'HEAD') {
    const upstreamGet = await fetch(proxyUrl.toString(), {
      method: 'GET',
      headers: proxyHeaders,
    });
    const responseHeaders = new Headers(upstreamGet.headers);
    if ((upstreamGet.headers.get('content-type') || '').includes('text/event-stream')) {
      responseHeaders.set('cache-control', 'no-cache');
    }
    return new Response(null, { status: upstreamGet.status, headers: responseHeaders });
  }

  // For GET requests, use the resilient SSE proxy that auto-reconnects on upstream
  // failures. This prevents ERR_INCOMPLETE_CHUNKED_ENCODING errors in the browser.
  if ((req.method || 'GET').toUpperCase() === 'GET') {
    const headers = proxyHeaders;
    return createResilientSseProxy(() => fetch(proxyUrl.toString(), { method: 'GET', headers }));
  }

  // Non-GET: proxy via fetch and rewrap SSE bodies when needed
  const proxied = await fetch(proxyUrl.toString(), {
    method: req.method,
    headers: proxyHeaders,
    body: req.body,
  });

  const contentType = proxied.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    return streamUpstreamResponse(proxied);
  }

  return proxied;
}

export async function proxyConsoleUpgrade(req: Request, proxyUrl: string, proxyBase: string): Promise<Response> {
  try {
    const BROADCASTING_HOST = process.env.BROADCASTING_HOST ?? 'localhost';
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
  } catch (err) {
    return new Response('upgrade failed', { status: 500 });
  }
}

// proxyConsoleUpgrade is exported by its declaration above

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

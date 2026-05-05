import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import {
  buildProxyHeaders,
  computeProxyBase,
  computeProxyUrl,
  forwardSSEEventsToSink,
  fetchMetaSnapshot,
  proxyConsoleApiWsRequest,
  setBroadcastingTarget,
} from "../../lib/console-proxy";
export { setBroadcastingTarget } from "../../lib/console-proxy";
import * as agentState from "./api/agent-state";
import * as speechHistory from "./api/speech-history";
import robotsTxt from "./robots.txt";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONSOLE_BUILD_PATH = process.env.CONSOLE_BUILD_PATH ?? resolve(process.cwd(), 'var/console/build');
const CONSOLE_SOURCE_HTML_PATH = resolve(process.cwd(), 'console/src/index.html');
const CONSOLE_PUBLIC_PATH = '/console/';

let consoleBuildPromise: Promise<void> | null = null;
let builtConsoleHtml: string | null = null;

function getContentType(filePath: string): string | undefined {
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  return undefined;
}

function normalizeConsoleHtml(source: string): string {
  // Rewrite the TypeScript entrypoint reference to the compiled JS output
  // so the browser requests the Bun.build() artefact instead of the raw .tsx file.
  return source.replace(/src="\.\/frontend\.tsx"/, 'src="./frontend.js"');
}

async function buildConsoleApp() {
  mkdirSync(CONSOLE_BUILD_PATH, { recursive: true });
  const result = await Bun.build({
    entrypoints: [resolve(process.cwd(), 'console/src/frontend.tsx')],
    outdir: CONSOLE_BUILD_PATH,
    publicPath: CONSOLE_PUBLIC_PATH,
    splitting: true,
    target: 'browser',
    minify: process.env.NODE_ENV === 'production',
  });

  if (!result.success) {
    throw new Error('Console frontend build failed');
  }

  const sourceHtml = readFileSync(CONSOLE_SOURCE_HTML_PATH, 'utf-8');
  builtConsoleHtml = normalizeConsoleHtml(sourceHtml);
}

function ensureConsoleBuilt(): Promise<void> {
  if (!consoleBuildPromise) {
    consoleBuildPromise = (async () => {
      try {
        await buildConsoleApp();
      } catch (error) {
        console.error('[ERROR] console build failed', error);
        throw error;
      }
    })();
  }
  return consoleBuildPromise;
}

function getConsoleAssetPath(pathname: string): string | null {
  if (!pathname.startsWith(CONSOLE_PUBLIC_PATH)) {
    return null;
  }
  const assetPath = pathname.slice(CONSOLE_PUBLIC_PATH.length);
  if (!assetPath) {
    return null;
  }
  const resolved = resolve(CONSOLE_BUILD_PATH, assetPath);
  if (!resolved.startsWith(CONSOLE_BUILD_PATH + '/')) {
    return null;
  }
  if (!existsSync(resolved)) {
    return null;
  }
  return resolved;
}

async function serveConsoleAsset(req: Request): Promise<Response | null> {
  await ensureConsoleBuilt();
  const url = new URL(req.url);
  const assetPath = getConsoleAssetPath(url.pathname);
  if (!assetPath) return null;

  const headers: Record<string, string> = {};
  const contentType = getContentType(assetPath);
  if (contentType) headers['Content-Type'] = contentType;

  return new Response(Bun.file(assetPath), { headers });
}

async function serveConsoleAppHtml(): Promise<Response> {
  await ensureConsoleBuilt();
  return new Response(builtConsoleHtml ?? '', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

try {
  console.log('[DEBUG] routes/console initializing');
} catch {}

export const { upgradeWebSocket, websocket } = createBunWebSocket();

export const app = new Hono()
  .get('/console/api/ws', async (c, next) => {
    try { console.log('[TRACE] incoming request headers ->', Object.fromEntries(c.req.raw.headers)); } catch {}
    try {
      const proxyBase = computeProxyBase(c.req.raw);
      const proxyUrl = computeProxyUrl(c.req.raw, proxyBase);
      try { console.log('[DEBUG] /console/api/ws proxy ->', { url: proxyUrl, method: c.req.method, accept: c.req.header('accept'), upgrade: c.req.header('upgrade'), secWebSocketKey: c.req.header('sec-websocket-key'), secWebSocketProtocol: c.req.header('sec-websocket-protocol') }); } catch {}

      const upgradeHeader = (c.req.header('upgrade') ?? '').toLowerCase();
      const hasSecWebSocketKey = !!c.req.header('sec-websocket-key');
      if (upgradeHeader === 'websocket' || hasSecWebSocketKey) {
        // Hand off to the upgradeWebSocket middleware below.
        return next();
      }

      const proxyHeaders = buildProxyHeaders(c.req.raw, proxyBase);
      return proxyConsoleApiWsRequest(c.req.raw, proxyUrl, proxyHeaders);
    } catch (err) {
      return new Response('proxy failed', { status: 502 });
    }
  }, upgradeWebSocket((c) => {
    const proxyBase = computeProxyBase(c.req.raw);
    let cancelForward: (() => void) | null = null;

    return {
      onOpen(_event, ws) {
        (async () => {
          try {
            try { console.log('[DEBUG] websocket upgrade accepted; starting SSE->WS forwarder'); } catch {}
            const sseUrl = `${proxyBase}/console/api/ws`;
            try { console.log('[DEBUG] opening upstream SSE fetch ->', sseUrl); } catch {}
            const res = await fetch(sseUrl, { headers: { accept: 'text/event-stream' } });
            try { console.log('[DEBUG] upstream SSE response ->', { status: res.status, contentType: res.headers.get('content-type') }); } catch {}

            try {
              const metaJson = await fetchMetaSnapshot(proxyBase);
              try { ws.send(JSON.stringify(metaJson)); } catch {}
            } catch (err) {
              try { console.warn('[DIAG] failed to send initial meta snapshot', String(err)); } catch {}
            }

            const upstreamBody = res.body;
            if (!upstreamBody) {
              try {
                const json = await res.json().catch(() => ({}));
                try { ws.send(JSON.stringify(json)); } catch {}
              } catch {}
              return;
            }

            cancelForward = forwardSSEEventsToSink(upstreamBody, (data) => {
              try { ws.send(data); } catch {}
            });
          } catch (err) {
            try { console.warn('[WARN] websocket bridge failed', String(err)); } catch {}
            try { ws.close(); } catch {}
          }
        })();
      },
      onMessage() {},
      onClose() { cancelForward?.(); },
      onError() { cancelForward?.(); },
    };
  }))
  .get('/console/robots.txt', () => robotsTxt)
  .get('/console/api/agent-state', () => agentState.GET())
  .get('/console/api/speech-history', (c) => speechHistory.GET(c.req.raw))
  .get('/console/frontend.js', async (c) => await serveConsoleAsset(c.req.raw) ?? new Response('Not Found', { status: 404 }))
  .get('/console/frontend.css', async (c) => await serveConsoleAsset(c.req.raw) ?? new Response('Not Found', { status: 404 }))
  .get('/console/*', () => serveConsoleAppHtml());

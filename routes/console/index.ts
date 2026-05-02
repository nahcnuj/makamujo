import {
  buildProxyHeaders,
  computeProxyBase,
  computeProxyUrl,
  proxyConsoleApiWsRequest,
  proxyConsoleUpgrade,
  setBroadcastingTarget,
} from "../../lib/console-proxy";
export { setBroadcastingTarget } from "../../lib/console-proxy";
import App from "../../console/src/index.html";
import * as agentState from "./api/agent-state";
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
  return source;
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

  '/console/robots.txt': robotsTxt,
  '/console/api/agent-state': agentState,
  '/console/frontend.js': async (req: Request) => {
    return await serveConsoleAsset(req) ?? await serveConsoleAppHtml();
  },
  '/console/frontend.css': async (req: Request) => {
    return await serveConsoleAsset(req) ?? await serveConsoleAppHtml();
  },

  '/console/*': App,
};

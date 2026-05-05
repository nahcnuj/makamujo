import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const MAIN_BUILD_PATH = resolve(process.cwd(), 'var/main/build');
const MAIN_SOURCE_HTML_PATH = resolve(process.cwd(), 'src/index.html');

let mainBuildPromise: Promise<void> | null = null;
let builtMainHtml: string | null = null;

function getContentType(filePath: string): string | undefined {
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  return undefined;
}

function normalizeMainHtml(source: string): string {
  const rewrittenHtml = source.replace(/src=(['"])\.\/frontend\.tsx\1/, 'src=$1./frontend.js$1');
  if (rewrittenHtml.match(/<link[^>]+href=(['"])\.\/frontend\.css\1/)) {
    return rewrittenHtml;
  }
  return rewrittenHtml.replace(/<\/head>/i, '  <link rel="stylesheet" href="./frontend.css" />\n</head>');
}

async function buildMainFrontend() {
  mkdirSync(MAIN_BUILD_PATH, { recursive: true });
  const result = await Bun.build({
    entrypoints: [resolve(process.cwd(), 'src/frontend.tsx')],
    outdir: MAIN_BUILD_PATH,
    publicPath: '/',
    splitting: true,
    target: 'browser',
    minify: process.env.NODE_ENV === 'production',
    // @ts-expect-error: alias is a valid Bun.build option but not yet typed in bun-types
    alias: {
      'react': 'hono/jsx/dom',
      'react/jsx-runtime': 'hono/jsx/dom/jsx-runtime',
    },
  });
  if (!result.success) {
    throw new Error('Main frontend build failed');
  }

  builtMainHtml = normalizeMainHtml(readFileSync(MAIN_SOURCE_HTML_PATH, 'utf-8'));
}

function ensureMainFrontendBuilt(): Promise<void> {
  if (!mainBuildPromise) {
    mainBuildPromise = (async () => {
      try {
        await buildMainFrontend();
      } catch (error) {
        mainBuildPromise = null;
        console.error('[ERROR] main frontend build failed', error);
        throw error;
      }
    })();
  }
  return mainBuildPromise;
}

function getMainFrontendAssetPath(pathname: string): string | null {
  if (!pathname.includes('.') || pathname.endsWith('/')) return null;

  const resolved = resolve(MAIN_BUILD_PATH, pathname.slice(1));
  const normalizedBuildPath = resolve(MAIN_BUILD_PATH);
  const normalizedResolved = resolve(resolved);
  const relativePath = relative(normalizedBuildPath, normalizedResolved);
  if (relativePath.startsWith('..')) return null;
  if (!existsSync(normalizedResolved)) return null;
  return normalizedResolved;
}

export async function handleCatchAll(req: Request): Promise<Response> {
  await ensureMainFrontendBuilt();
  const url = new URL(req.url);

  const assetPath = getMainFrontendAssetPath(url.pathname);
  if (assetPath) {
    const headers: Record<string, string> = {};
    const contentType = getContentType(assetPath);
    if (contentType) headers['Content-Type'] = contentType;
    return new Response(Bun.file(assetPath), { headers });
  }

  if (!builtMainHtml) {
    return new Response('Frontend build incomplete', { status: 503 });
  }

  return new Response(builtMainHtml, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

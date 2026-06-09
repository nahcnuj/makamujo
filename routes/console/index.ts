import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import {
  buildProxyHeaders,
  computeProxyBase,
  computeProxyUrl,
  fetchMetaSnapshot,
  forwardSSEEventsToSink,
  proxyConsoleApiWsRequest,
} from "../../lib/console-proxy";

export { setBroadcastingTarget } from "../../lib/console-proxy";

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { compileTailwindCss, createCssResponse } from "../../lib/tailwind";
import * as agentState from "./api/agent-state";
import * as speechHistory from "./api/speech-history";
import robotsTxt from "./robots.txt";

const CONSOLE_BUILD_PATH =
  process.env.CONSOLE_BUILD_PATH ?? resolve(process.cwd(), "var/console/build");
const CONSOLE_SOURCE_HTML_PATH = resolve(
  process.cwd(),
  "console/src/index.html",
);
const CONSOLE_PUBLIC_PATH = "/console/";

let consoleBuildPromise: Promise<void> | null = null;
let builtConsoleHtml: string | null = null;

function getContentType(filePath: string): string | undefined {
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  return undefined;
}

function normalizeConsoleHtml(source: string): string {
  // Rewrite the TypeScript entrypoint reference to the compiled JS output
  // so the browser requests the Bun.build() artefact instead of the raw .tsx file.
  return source.replace(/src="\.\/frontend\.tsx"/, 'src="./frontend.js"');
}

async function buildConsoleApp(watch: boolean = false) {
  mkdirSync(CONSOLE_BUILD_PATH, { recursive: true });
  const result = await Bun.build({
    entrypoints: [resolve(process.cwd(), "console/src/frontend.tsx")],
    outdir: CONSOLE_BUILD_PATH,
    publicPath: CONSOLE_PUBLIC_PATH,
    splitting: true,
    target: "browser",
    minify: process.env.NODE_ENV === "production",
    // @ts-expect-error: alias is a valid Bun.build option but not yet typed in bun-types
    alias: {
      react: "hono/jsx/dom",
      "react/jsx-runtime": "hono/jsx/dom/jsx-runtime",
      "react/jsx-dev-runtime": "hono/jsx/dom/jsx-dev-runtime",
      "hono/jsx": "hono/jsx/dom",
      "hono/jsx/jsx-runtime": "hono/jsx/dom/jsx-runtime",
      "hono/jsx/jsx-dev-runtime": "hono/jsx/dom/jsx-dev-runtime",
    },
    watch,
  });

  if (!result.success) {
    throw new Error("Console frontend build failed");
  }

  const sourceHtml = readFileSync(CONSOLE_SOURCE_HTML_PATH, "utf-8");
  builtConsoleHtml = normalizeConsoleHtml(sourceHtml);
}

function ensureConsoleBuilt(): Promise<void> {
  if (!consoleBuildPromise) {
    const isProd = process.env.NODE_ENV === "production";
    consoleBuildPromise = (async () => {
      try {
        // In development, enable Bun.build watch mode so the bundler
        // incrementally rebuilds when `console/src` files change. In
        // production, perform a single minified build.
        await buildConsoleApp(!isProd);
      } catch (error) {
        console.error("[ERROR] console build failed", error);
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
  const normalizedBuildPath = resolve(CONSOLE_BUILD_PATH);
  const normalizedResolved = resolve(resolved);
  const relativePath = relative(normalizedBuildPath, normalizedResolved);
  if (relativePath.startsWith("..")) {
    return null;
  }
  if (!existsSync(normalizedResolved)) {
    return null;
  }
  return normalizedResolved;
}

async function serveConsoleAsset(req: Request): Promise<Response | null> {
  await ensureConsoleBuilt();
  const url = new URL(req.url);
  const assetPath = getConsoleAssetPath(url.pathname);
  if (!assetPath) return null;

  const headers: Record<string, string> = {};
  const contentType = getContentType(assetPath);
  if (contentType) headers["Content-Type"] = contentType;

  return new Response(Bun.file(assetPath), { headers });
}

async function serveConsoleAppHtml(): Promise<Response> {
  await ensureConsoleBuilt();
  return new Response(builtConsoleHtml ?? "", {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

try {
  console.debug("[DEBUG] routes/console initializing");
} catch {}

export const { upgradeWebSocket, websocket } = createBunWebSocket();

export const app = new Hono()
  // Ensure /api/meta is available on the loopback console server by proxying
  // requests to the broadcasting server. Some test setups may point the
  // broadcasting base URL at the console loopback; forwarding here ensures
  // a JSON response is always returned.
  .get("/api/meta", async (c) => {
    try {
      const proxyBase = computeProxyBase(c.req.raw);
      const res = await fetch(`${proxyBase}/api/meta`);
      return res;
    } catch (_err) {
      return new Response("{}", {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  })
  .get(
    "/console/api/ws",
    async (c, next) => {
      try {
        console.debug(
          "[DEBUG] incoming request headers ->",
          Object.fromEntries(c.req.raw.headers),
        );
      } catch {}
      try {
        const proxyBase = computeProxyBase(c.req.raw);
        const proxyUrl = computeProxyUrl(c.req.raw, proxyBase);
        try {
          console.debug("[DEBUG] /console/api/ws proxy ->", {
            url: proxyUrl,
            method: c.req.method,
            accept: c.req.header("accept"),
            upgrade: c.req.header("upgrade"),
            secWebSocketKey: c.req.header("sec-websocket-key"),
            secWebSocketProtocol: c.req.header("sec-websocket-protocol"),
          });
        } catch {}

        const upgradeHeader = (c.req.header("upgrade") ?? "").toLowerCase();
        const hasSecWebSocketKey = !!c.req.header("sec-websocket-key");
        const forceDisableWs =
          process.env.FORCE_DISABLE_WS_UPGRADE === "1" ||
          process.env.FORCE_DISABLE_WS_UPGRADE === "true";
        if (upgradeHeader === "websocket" || hasSecWebSocketKey) {
          if (forceDisableWs) {
            return new Response("websocket upgrade unavailable", {
              status: 501,
            });
          }
          // Hand off to the upgradeWebSocket middleware below.
          return next();
        }

        const proxyHeaders = buildProxyHeaders(c.req.raw, proxyBase);
        // Proxy the request to the broadcasting server so the console client
        // receives the upstream SSE stream (with resilient reconnects) or the
        // proxied HTTP response. Avoid special-casing self-proxying here to
        // ensure console clients get the authoritative upstream events.
        return proxyConsoleApiWsRequest(c.req.raw, proxyUrl, proxyHeaders);
      } catch (_err) {
        return new Response("proxy failed", { status: 502 });
      }
    },
    upgradeWebSocket((c) => {
      const proxyBase = computeProxyBase(c.req.raw);
      let cancelForward: (() => void) | null = null;

      return {
        onOpen(_event, ws) {
          (async () => {
            try {
              try {
                console.debug(
                  "[DEBUG] websocket upgrade accepted; starting SSE->WS forwarder",
                );
              } catch {}
              const sseUrl = `${proxyBase}/console/api/ws`;
              try {
                console.debug("[DEBUG] opening upstream SSE fetch ->", sseUrl);
              } catch {}
              const res = await fetch(sseUrl, {
                headers: { accept: "text/event-stream" },
              });
              try {
                console.debug("[DEBUG] upstream SSE response ->", {
                  status: res.status,
                  contentType: res.headers.get("content-type"),
                });
              } catch {}

              if (!res.ok) {
                try {
                  console.warn(
                    "[WARN] upstream SSE fetch failed with status",
                    res.status,
                  );
                } catch {}
                // Send local metadata and close gracefully instead of erroring
                try {
                  const metaJson = await fetchMetaSnapshot(proxyBase).catch(
                    () => ({}),
                  );
                  try {
                    ws.send(JSON.stringify(metaJson));
                  } catch {}
                } catch {}
                return;
              }

              try {
                const metaJson = await fetchMetaSnapshot(proxyBase);
                try {
                  ws.send(JSON.stringify(metaJson));
                } catch {}

                // If the proxied HTTP snapshot lacked `niconama`, prefer the
                // authoritative local payload mirror when available so WebSocket
                // upgrade clients receive immediate stream metadata.
                try {
                  if (
                    !metaJson ||
                    typeof metaJson !== "object" ||
                    !(metaJson as Record<string, unknown>).niconama
                  ) {
                    const globalThis$ = globalThis as Record<string, unknown>;
                    const getPayload = globalThis$.__getCurrentStreamPayload;
                    const local =
                      typeof getPayload === "function"
                        ? getPayload()
                        : undefined;
                    if (
                      local &&
                      typeof local === "object" &&
                      (local as Record<string, unknown>).niconama
                    ) {
                      try {
                        ws.send(JSON.stringify(local));
                      } catch {}
                      try {
                        console.debug(
                          "[DIAG] websocket sent local mirrored payload with niconama",
                        );
                      } catch {}
                    }
                  }
                } catch {}
              } catch (err) {
                try {
                  console.warn(
                    "[DIAG] failed to send initial meta snapshot",
                    String(err),
                  );
                } catch {}
              }

              const upstreamBody = res.body;
              if (!upstreamBody) {
                try {
                  const json = await res.json().catch(() => ({}));
                  try {
                    ws.send(JSON.stringify(json));
                  } catch {}
                } catch {}
                return;
              }

              cancelForward = forwardSSEEventsToSink(upstreamBody, (data) => {
                try {
                  ws.send(data);
                } catch {}
              });
            } catch (err) {
              try {
                console.warn("[WARN] websocket bridge failed", String(err));
              } catch {}
              try {
                ws.close();
              } catch {}
            }
          })().catch((err) => {
            try {
              console.error(
                "[ERROR] websocket onOpen handler error",
                String(err),
              );
            } catch {}
          });
        },
        onMessage() {},
        onClose() {
          cancelForward?.();
        },
        onError() {
          cancelForward?.();
        },
      };
    }),
  )
  .get("/console/robots.txt", () => robotsTxt.clone())
  .get("/console/api/agent-state", (c) => agentState.GET(c.req.raw))
  .get("/console/api/speech-history", (c) => speechHistory.GET(c.req.raw))
  .get("/console/index.css", async (c) => {
    const css = await compileTailwindCss("console/src/index.css");
    return createCssResponse(css, c.req.raw);
  })
  .get(
    "/console/frontend.js",
    async (c) =>
      (await serveConsoleAsset(c.req.raw)) ??
      new Response("Not Found", { status: 404 }),
  )
  .get("/console", () => serveConsoleAppHtml())
  .get(
    "/console/frontend.css",
    async (c) =>
      (await serveConsoleAsset(c.req.raw)) ??
      new Response("Not Found", { status: 404 }),
  )
  .get("/console/*", () => serveConsoleAppHtml());

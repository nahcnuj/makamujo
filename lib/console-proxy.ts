import {
  drainSseDataPayloads,
  extractCompleteSseFrames,
} from "./domain/console/sseFrames";

export {
  extractCompleteSseFrames,
  findSseBoundary,
} from "./domain/console/sseFrames";

export function streamUpstreamResponse(proxied: Response) {
  const responseHeaders = new Headers(proxied.headers);
  responseHeaders.set("cache-control", "no-cache");
  // Remove content-length to avoid mismatches when streaming/chunked.
  responseHeaders.delete("content-length");
  const upstreamBody: any = proxied.body;
  if (upstreamBody && typeof upstreamBody.getReader === "function") {
    const wrapped = new ReadableStream({
      start(controller) {
        const reader = upstreamBody.getReader();
        (async () => {
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
            try {
              controller.error(e);
            } catch {}
          } finally {
            try {
              reader.releaseLock();
            } catch {}
          }
        })();
      },
      cancel() {
        try {
          upstreamBody.cancel?.();
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

export function forwardSSEEventsToSink(
  upstreamBody: any,
  sink: (data: string) => void,
) {
  if (!upstreamBody || typeof upstreamBody.getReader !== "function") {
    return () => {};
  }
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let stopped = false;

  (async () => {
    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const drained = drainSseDataPayloads(buffer);
        buffer = drained.rest;
        for (const data of drained.payloads) {
          try {
            sink(data);
          } catch {}
        }
      }
    } catch (err) {
      try {
        console.warn("[DIAG] SSE reader failed", String(err));
      } catch {}
    } finally {
      try {
        reader.cancel && typeof reader.cancel === "function" && reader.cancel();
      } catch {}
    }
  })();

  return () => {
    stopped = true;
    try {
      reader.cancel && typeof reader.cancel === "function" && reader.cancel();
    } catch {}
  };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const sanitizeBroadcastingHost = (host: string): string => {
  const normalized = host.trim().toLowerCase();
  if (LOOPBACK_HOSTS.has(normalized)) {
    return normalized === "::1" ? "127.0.0.1" : normalized;
  }
  return "127.0.0.1";
};

const sanitizeBroadcastingPort = (port: string | number): string => {
  const parsed =
    typeof port === "number" ? port : Number.parseInt(String(port), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return "7777";
  }
  return String(parsed);
};

let BROADCASTING_HOST = sanitizeBroadcastingHost(
  process.env.BROADCASTING_HOST ?? "localhost",
);
let BROADCASTING_PORT = sanitizeBroadcastingPort(
  process.env.BROADCASTING_PORT ?? "7777",
);

/**
 * Ensure an upstream proxy URL targets only the configured loopback broadcasting
 * server. Forces hostname/port after parsing so user-controlled path/query cannot
 * redirect the request (SSRF).
 */
export const toSafeLoopbackProxyUrl = (
  urlString: string,
  fallbackPath: string,
): string => {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    parsed = new URL(
      fallbackPath,
      `http://${BROADCASTING_HOST}:${BROADCASTING_PORT}`,
    );
  }
  parsed.protocol = "http:";
  parsed.hostname = BROADCASTING_HOST;
  parsed.port = BROADCASTING_PORT;
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
};

export function setBroadcastingTarget(host: string, port: string | number) {
  BROADCASTING_HOST = sanitizeBroadcastingHost(host);
  BROADCASTING_PORT = sanitizeBroadcastingPort(port);
}

export function buildProxyHeaders(req: Request, proxyBase: string) {
  const proxyHeaders = new Headers(req.headers);
  try {
    const proxyBaseHost = new URL(proxyBase).host;
    proxyHeaders.set("host", proxyBaseHost);
  } catch {
    proxyHeaders.set("host", `${BROADCASTING_HOST}:${BROADCASTING_PORT}`);
  }
  proxyHeaders.delete("origin");
  proxyHeaders.delete("referer");
  if (!proxyHeaders.has("accept"))
    proxyHeaders.set("accept", "text/event-stream");
  return proxyHeaders;
}

/** Upstream base URL is always the validated loopback broadcasting target. */
export function computeProxyBase(_req?: Request) {
  return `http://${BROADCASTING_HOST}:${BROADCASTING_PORT}`;
}

export function computeProxyUrl(req: Request, proxyBase: string) {
  let search = "";
  try {
    search = new URL(req.url, "http://127.0.0.1").search;
  } catch {
    search = "";
  }
  return toSafeLoopbackProxyUrl(
    `${proxyBase}/console/api/ws${search}`,
    "/console/api/ws",
  );
}

export async function fetchMetaSnapshot(proxyBase: string): Promise<any> {
  try {
    const metaUrl = toSafeLoopbackProxyUrl(
      `${proxyBase}/api/meta`,
      "/api/meta",
    );
    const res = await fetch(metaUrl);
    return await res.json().catch(() => ({}));
  } catch (err) {
    try {
      console.warn("[DIAG] fetchMetaSnapshot failed", String(err));
    } catch {}
    return {};
  }
}

/**
 * Creates an SSE Response that stays connected even when the upstream drops.
 * When the upstream closes or errors, it automatically reconnects and continues
 * streaming. This prevents ERR_INCOMPLETE_CHUNKED_ENCODING errors in the browser
 * caused by the upstream connection dropping mid-stream.
 *
 * Only complete SSE frames (delimited by \n\n or \r\n\r\n) are forwarded; any
 * incomplete frame in the buffer is silently dropped when the upstream disconnects,
 * preventing partial/corrupt events from reaching the browser's EventSource.
 *
 * @param firstResponse - The initial upstream SSE response (already fetched by caller).
 * @param fetchUpstream - Factory called on each reconnect; receives an AbortSignal.
 * @param reconnectDelayMs - Delay before reconnecting after upstream drop.
 * @param keepaliveIntervalMs - Periodically sends SSE comment pings on idle downstream
 *   connections to avoid idle chunked-encoding termination.
 */
export function createResilientSseProxy(
  firstResponse: Response,
  fetchUpstream: (signal: AbortSignal) => Promise<Response>,
  reconnectDelayMs = 500,
  keepaliveIntervalMs = 5_000,
): Response {
  let stopped = false;
  let abortController = new AbortController();
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  const encoder = new TextEncoder();

  // Preserve SSE-relevant headers from the initial upstream response.
  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", "text/event-stream");
  responseHeaders.set("Cache-Control", "no-cache");
  responseHeaders.set("Connection", "keep-alive");
  const corsHeader = firstResponse.headers.get("Access-Control-Allow-Origin");
  if (corsHeader)
    responseHeaders.set("Access-Control-Allow-Origin", corsHeader);

  const processUpstreamBody = async (
    upstream: Response,
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): Promise<void> => {
    const body = upstream.body as ReadableStream<Uint8Array> | null;
    if (!body || typeof body.getReader !== "function") return;

    const reader = body.getReader();
    currentReader = reader;
    const decoder = new TextDecoder();
    let sseBuffer = "";

    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });

        // Emit only complete SSE frames; buffer incomplete ones until the next chunk.
        const extracted = extractCompleteSseFrames(sseBuffer);
        sseBuffer = extracted.rest;
        for (const frame of extracted.frames) {
          try {
            controller.enqueue(encoder.encode(frame));
          } catch {}
        }
      }
    } finally {
      currentReader = null;
      // Any incomplete frame remaining in sseBuffer is discarded here, preventing
      // a truncated/corrupt event from being dispatched after reconnect.
      try {
        reader.cancel();
      } catch {}
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (keepaliveIntervalMs > 0) {
        keepaliveTimer = setInterval(() => {
          if (stopped) return;
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {}
        }, keepaliveIntervalMs);
      }

      (async () => {
        try {
          // Process the initial response body (already fetched by the caller).
          // Wrap in try-catch: an abrupt socket close on the upstream side causes
          // reader.read() to throw rather than return { done: true }, which must
          // not propagate and close the downstream stream prematurely.
          try {
            await processUpstreamBody(firstResponse, controller);
          } catch {}

          while (!stopped) {
            await new Promise<void>((r) => setTimeout(r, reconnectDelayMs));
            if (stopped) break;

            abortController = new AbortController();
            try {
              const upstream = await fetchUpstream(abortController.signal);
              try {
                await processUpstreamBody(upstream, controller);
              } catch {}
            } catch {
              // Connection failed; will retry after delay.
            }
          }
        } finally {
          if (keepaliveTimer) {
            clearInterval(keepaliveTimer);
            keepaliveTimer = null;
          }
          try {
            controller.close();
          } catch {}
        }
      })().catch(() => {
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      stopped = true;
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
      // Abort any in-flight reconnect fetch and cancel any active upstream reader,
      // allowing the loop to exit promptly without leaking the upstream connection.
      try {
        abortController.abort();
      } catch {}
      try {
        currentReader?.cancel();
      } catch {}
    },
  });

  return new Response(stream, {
    status: firstResponse.status,
    headers: responseHeaders,
  });
}

export async function proxyConsoleApiWsRequest(
  req: Request,
  proxyUrl: string,
  proxyHeaders: Headers,
): Promise<Response> {
  const safeProxyUrl = toSafeLoopbackProxyUrl(proxyUrl, "/console/api/ws");

  // HEAD handling: probe upstream with GET and return headers only
  if ((req.method || "GET").toUpperCase() === "HEAD") {
    const upstreamGet = await fetch(safeProxyUrl, {
      method: "GET",
      headers: proxyHeaders,
    });
    const responseHeaders = new Headers(upstreamGet.headers);
    if (
      (upstreamGet.headers.get("content-type") || "").includes(
        "text/event-stream",
      )
    ) {
      responseHeaders.set("cache-control", "no-cache");
    }
    return new Response(null, {
      status: upstreamGet.status,
      headers: responseHeaders,
    });
  }

  // For SSE GET requests, probe upstream once and use the resilient proxy if SSE is returned.
  // This prevents ERR_INCOMPLETE_CHUNKED_ENCODING errors in the browser caused by upstream drops.
  if (
    (req.method || "GET").toUpperCase() === "GET" &&
    (req.headers.get("accept") ?? "").includes("text/event-stream")
  ) {
    const probe = await fetch(safeProxyUrl, {
      method: "GET",
      headers: proxyHeaders,
    });
    const contentType = probe.headers.get("content-type") ?? "";
    if (!probe.ok || !contentType.includes("text/event-stream")) {
      // Upstream returned a non-SSE or error response — pass it through as-is.
      return streamUpstreamResponse(probe);
    }
    const headers = proxyHeaders;
    return createResilientSseProxy(probe, (signal) =>
      fetch(safeProxyUrl, { method: "GET", headers, signal }),
    );
  }

  // Non-SSE GET or non-GET: proxy via fetch and rewrap SSE bodies when needed
  const proxied = await fetch(safeProxyUrl, {
    method: req.method,
    headers: proxyHeaders,
    body: req.body,
  });

  const contentType = proxied.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return streamUpstreamResponse(proxied);
  }

  return proxied;
}

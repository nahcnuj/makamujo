// Dynamically import `automated-gameplay-transmitter` at runtime so that
// its internal IPC listeners do not run during module evaluation which
// can cause uncaught exceptions on CI (e.g., named-pipe collisions).
// We'll initialize a fallback agent first and replace it if the import
// and initialization succeed.
import { serve } from "bun";
import { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
// Use the global `setInterval` timer instead of the Node
// `timers/promises` async iterator. The async iterator can behave
// inconsistently across runtimes; using a classic timer keeps the
// process alive reliably.
import { parseArgs } from "node:util";
import { startConsoleServer } from "./console/index";
import { FallbackTTS, MakaMujo, MarkovChainModel, TTS } from "./lib/server";
import * as index from "./routes/index";
import * as speechHistoryRoute from "./routes/api/speech-history";
import type { SpeechHistoryEntry } from "./routes/api/speech-history";
import { handleCatchAll } from "./src/frontendServer";
import { compileTailwindCss, createCssResponse } from "./lib/tailwind";
import { normalizePublishedStreamState } from "./lib/streamState";

process.on('exit', exitHandler.bind(null, { cleanup: true }));
process.on('SIGINT', signalHandler.bind(null, { exit: true }));
process.on('SIGUSR1', signalHandler.bind(null, { exit: true }));
process.on('SIGUSR2', signalHandler.bind(null, { exit: true }));
// Log uncaught exceptions for better diagnostics before invoking the
// existing exit handler which terminates the process.
process.on('uncaughtException', (err) => {
  try {
    console.error('[UNCAUGHT_EXCEPTION]', err instanceof Error ? err.stack ?? err.message : String(err));
  } catch {
    // ignore logging failures
  }
});
process.on('unhandledRejection', (reason) => {
  try {
    console.error('[UNHANDLED_REJECTION]', reason instanceof Error ? reason.stack ?? reason.message : String(reason));
  } catch { }
});
process.on('uncaughtException', (err) => {
  try {
    // Log the exception for diagnostics
    console.error('[UNCAUGHT_EXCEPTION]', err instanceof Error ? err.stack ?? err.message : String(err));
  } catch { }

  // Do not terminate the process for transient IPC listen failures
  // (e.g., EADDRINUSE on Windows named pipes) so tests can recover.
  const message = err instanceof Error ? (err.message ?? '') : String(err);
  if (message.includes('Failed to listen at') || message.includes('EADDRINUSE')) {
    console.warn('[WARN] Ignoring transient IPC listen error to keep server running for tests:', message);
    return;
  }

  // For other uncaught exceptions, perform the existing exit behavior.
  exitHandler({ exit: true }, 1);
});

const { values: {
  model: modelFile,
  data: dataFile,
  port,
} } = parseArgs({
  options: {
    model: {
      short: 'm',
      type: 'string',
      default: './var/model.json',
    },
    data: {
      short: 'd',
      type: 'string',
      default: './var/cookieclicker.txt',
    },
    port: {
      short: 'p',
      // parseArgs only supports 'string' and 'boolean'; convert to Number when using
      type: 'string',
      default: '7777',
    },
  },
});

const model = (file => {
  try {
    return MarkovChainModel.fromFile(file);
  } catch (err) {
    console.warn('failed to open the file', file);
    return new MarkovChainModel();
  }
})(modelFile);

const tts = process.platform !== 'win32' ?
  (() => {
    const htsvoiceFile = '/usr/share/hts-voice/nitech-jp-atr503-m001/nitech_jp_atr503_m001.htsvoice';
    const dictionaryDir = '/var/lib/mecab/dic/open-jtalk/naist-jdic';
    return new TTS({
      htsvoiceFile,
      dictionaryDir,
    });
  })() :
  new FallbackTTS();

const streamer = new MakaMujo(model, tts);

// Provide an in-memory fallback agent synchronously so the rest of the
// server initialization can reference `agent` without awaiting a dynamic
// import. We'll try to dynamically import and initialize the real
// `automated-gameplay-transmitter` agent later and replace this fallback
// when possible.
let lastPublishedStreamState: unknown = undefined;
let currentSpeechState = { speech: '', silent: false };
// WebSocket clients connected to the broadcasting server.
const wsClients = new Set<any>();

// Server-Sent Events (SSE) clients: store controller objects so we can
// push `data: ...\n\n` frames to each connected client.
const sseClients = new Set<ReadableStreamDefaultController<string>>();

/**
 * Create a ReadableStream that registers its controller in `sseClients` and
 * removes it when the client disconnects (cancel) or when the handler rejects.
 * Centralising the creation avoids duplicating the closure-capture pattern.
 */
const createSseStream = (label: string) => {
  let ctl: ReadableStreamDefaultController<string> | undefined;
  return new ReadableStream<string>({
    start(controller) {
      try { console.log(`[INFO] SSE client connected (${label})`); } catch { }
      ctl = controller;
      sseClients.add(controller);
      try { controller.enqueue(`data: ${JSON.stringify(getCurrentStreamPayload())}\n\n`); } catch { }
    },
    cancel() { if (ctl) { try { sseClients.delete(ctl); } catch { } ctl = undefined; } },
  });
};

const sseBroadcast = (payload: unknown) => {
  if (sseClients.size === 0) return;
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  try { console.log('[INFO] sseBroadcast -> sseClients count=', sseClients.size); } catch { }
  for (const controller of Array.from(sseClients)) {
    try {
      // Evict clients under backpressure (desiredSize <= 0) to avoid blocking
      // the event loop when a slow or unread connection fills its TCP send buffer.
      // null means the stream is already closed/errored; treat that like healthy.
      if ((controller.desiredSize ?? 1) <= 0) {
        try { controller.close(); } catch { }
        sseClients.delete(controller);
        continue;
      }
      controller.enqueue(frame);
    } catch (err) {
      try { controller.close(); } catch { }
      try { sseClients.delete(controller); } catch { }
    }
  }
};

const broadcastToWsClients = (payload: unknown) => {
  const message = JSON.stringify(payload);
  for (const ws of Array.from(wsClients)) {
    try {
      ws.send(message);
    } catch (err) {
      try { ws.close(); } catch { }
      try { wsClients.delete(ws); } catch { }
    }
  }
};

const broadcastCurrentPayload = (context: string) => {
  try {
    const payload = getCurrentStreamPayload();
    sseBroadcast(payload);
    broadcastToWsClients(payload);
  } catch (err) {
    console.warn(`[WARN] failed to broadcast to clients (${context}):`, err instanceof Error ? err.message : String(err));
  }
};


const getCurrentStreamPayload = () => {
  const agentStreamState = agent.getStreamState?.();
  const streamState = (lastPublishedStreamState === undefined || lastPublishedStreamState === null)
    ? agentStreamState
    : lastPublishedStreamState;
  const normalizedStreamState = normalizePublishedStreamState(streamState);
  const base = normalizedStreamState && typeof normalizedStreamState === 'object' ? (normalizedStreamState as any) : {};
  const replyTargetComment = base.replyTargetComment && typeof base.replyTargetComment === 'object'
    ? base.replyTargetComment
    : undefined;

  return {
    niconama: base.niconama ?? {},
    canSpeak: base.canSpeak ?? streamer.canSpeak,
    currentGame: base.currentGame ?? streamer.currentGame ?? null,
    nGram: base.nGram ?? streamer.currentNGramSize,
    nGramRaw: base.nGramRaw ?? streamer.currentNGramSizeRaw,
    speech: base.speech ?? agent.getSpeech(),
    speechHistory: (Array.isArray(base.speechHistory) ? base.speechHistory : generatedSpeechHistory).slice(0, GENERATED_SPEECH_HISTORY_SSE_SIZE),
    replyTargetComment,
    commentCount: base.commentCount ?? streamer.streamState?.meta?.total?.comments,
  } as const;
};

const normalizeSpeechText = (speech: unknown): string | undefined => {
  if (typeof speech === 'string') {
    return speech;
  }

  if (!speech || typeof speech !== 'object') {
    return undefined;
  }

  if (typeof (speech as any).text === 'string') {
    return (speech as any).text;
  }

  if (typeof (speech as any).speech === 'string') {
    return (speech as any).speech;
  }

  return undefined;
};

let agent: any = {
  setSpeech: (text: string) => { currentSpeechState = { speech: text, silent: false }; },
  getSpeech: () => currentSpeechState,
  getGame: () => null,
  getStreamState: () => lastPublishedStreamState,
  publishStreamState: (data: unknown) => { lastPublishedStreamState = data; },
  postComments: (_: unknown) => { },
};

// Attempt to dynamically load the external agent API. This avoids module
// evaluation side-effects at import time (such as binding to IPC paths)
// which can cause transient failures in CI and local test runs.
(async () => {
  try {
    const mod = await import("automated-gameplay-transmitter");
    if (typeof mod.createAgentApi === 'function') {
      try {
        const externalAgent = mod.createAgentApi(streamer);
        agent = externalAgent;
        console.info('[INFO] external agent API initialized');
      } catch (err) {
        console.warn('[WARN] createAgentApi threw, keeping in-memory fallback:', err instanceof Error ? err.message : String(err));
      }
    } else {
      console.warn('[WARN] automated-gameplay-transmitter did not export createAgentApi; using fallback agent');
    }
  } catch (err) {
    console.warn('[WARN] dynamic import failed, continuing with in-memory fallback agent:', err instanceof Error ? err.message : String(err));
  }
})();
// Keep a larger buffer in memory for pagination while limiting the SSE payload size.
const GENERATED_SPEECH_HISTORY_BUFFER_SIZE = 200;
const GENERATED_SPEECH_HISTORY_SSE_SIZE = 20;
const generatedSpeechHistory: SpeechHistoryEntry[] = [];
let generatedSpeechHistorySequence = 0;

// Bind the in-memory array to the speech-history route handler.
speechHistoryRoute.setSpeechHistoryRef(generatedSpeechHistory);

let clearSpeechTimer: ReturnType<typeof setTimeout> | undefined = undefined;

streamer.onSpeech(async (event) => {
  const speechText = normalizeSpeechText(event) ?? '';
  const traceNodes = typeof event === 'object' && event !== null && Array.isArray((event as any).nodes) ? (event as any).nodes : undefined;
  const nGram = typeof event === 'object' && event !== null && typeof (event as any).nGram === 'number' ? (event as any).nGram : streamer.currentNGramSize;
  const nGramRaw = typeof event === 'object' && event !== null && typeof (event as any).nGramRaw === 'number' ? (event as any).nGramRaw : streamer.currentNGramSizeRaw;
  generatedSpeechHistorySequence += 1;
  generatedSpeechHistory.unshift({
    id: `speech-${generatedSpeechHistorySequence}`,
    speech: speechText,
    nGram,
    nGramRaw,
    nodes: traceNodes,
  });
  if (generatedSpeechHistory.length > GENERATED_SPEECH_HISTORY_BUFFER_SIZE) {
    generatedSpeechHistory.length = GENERATED_SPEECH_HISTORY_BUFFER_SIZE;
  }
  if (clearSpeechTimer) {
    clearTimeout(clearSpeechTimer);
    clearSpeechTimer = undefined;
  }
  agent.setSpeech(speechText);
  // Notify console clients immediately when a new utterance starts.
  broadcastCurrentPayload('onSpeech');
});

streamer.onSpeechComplete(async () => {
  if (clearSpeechTimer) {
    clearTimeout(clearSpeechTimer);
  }
  // Notify console clients that the utterance has finished.
  broadcastCurrentPayload('onSpeechComplete');
  clearSpeechTimer = setTimeout(() => {
    const speechState = agent.getSpeech();
    if (!speechState.silent) {
      agent.setSpeech('');
    }
    clearSpeechTimer = undefined;
    // Notify console clients that the displayed speech has been cleared.
    broadcastCurrentPayload('onSpeechClear');
  }, 1000);
});

// Notify console clients when game state changes via browser IPC.
streamer.onGameStateChange(() => {
  broadcastCurrentPayload('onGameStateChange');
});

// Defer starting the stream playback until after the HTTP servers are up.
// This reduces startup latency observed in CI where synchronous work here
// could delay the process becoming responsive to health checks.

const portNumber = parseInt(port ?? "7777", 10);
if (!Number.isFinite(portNumber) || portNumber < 1 || portNumber > 65535) {
  console.error(`Invalid port: ${port}. Must be an integer between 1 and 65535.`);
  process.exit(1);
}

// Hono app for API routes (delegated from the '/api/*' route below).
const apiApp = new Hono()
  .get('/api/speech', () => {
    const speechState = agent.getSpeech();
    return Response.json({
      speech: normalizeSpeechText(speechState) ?? '',
      silent: !!(speechState && typeof speechState === 'object' ? (speechState as any).silent : false),
    });
  })
  .get('/api/speech-history', (c) => speechHistoryRoute.GET(c.req.raw))
  .get('/api/game', () => {
    return Response.json(agent.getGame() ?? {});
  })
  .get('/api/meta', () => {
    return Response.json(getCurrentStreamPayload());
  })
  .post('/api/meta', async (c) => {
    try {
      let body: any;
      try {
        body = await c.req.json();
      } catch (err) {
        console.warn('[WARN] POST /api/meta failed to parse JSON body:', err instanceof Error ? err.message : String(err));
        return Response.json({}, { status: 400 });
      }

      const replyTargetComment = body && typeof body === 'object' && 'replyTargetComment' in body
        ? (body as any).replyTargetComment
        : undefined;
      let published: unknown = body;
      if (published && typeof published === 'object' && !('type' in published) && 'data' in published) {
        published = (published as any).data;
      }

      try {
        agent.publishStreamState?.(published);
      } catch (err) {
        console.warn('[WARN] failed to forward stream state to streamer:', err instanceof Error ? err.message : String(err));
      }

      try {
        published = normalizePublishedStreamState(published);
        if (replyTargetComment !== undefined) {
          if (published && typeof published === 'object') {
            (published as any).replyTargetComment = replyTargetComment;
          } else {
            published = { replyTargetComment };
          }
        }
      } catch (err) {
        console.warn('[WARN] failed to normalize published stream state:', err instanceof Error ? err.message : String(err));
      }

      try {
        lastPublishedStreamState = published;
      } catch (err) {
        console.warn('[WARN] failed to persist published stream state locally:', err instanceof Error ? err.message : String(err));
      }

      try {
        broadcastToWsClients(getCurrentStreamPayload());
      } catch (err) {
        console.warn('[WARN] failed to broadcast to WebSocket clients:', err instanceof Error ? err.message : String(err));
      }
      try {
        sseBroadcast(getCurrentStreamPayload());
      } catch (err) {
        console.warn('[WARN] failed to broadcast to SSE clients:', err instanceof Error ? err.message : String(err));
      }

      return Response.json({});
    } catch (err) {
      console.error('[ERROR] POST /api/meta handler crashed:', err instanceof Error ? err.stack ?? err.message : String(err));
      return Response.json({}, { status: 500 });
    }
  });

type WsData = { label: string };

const MAIN_BUILD_PATH = resolve(process.cwd(), 'var/main/build');
const MAIN_SOURCE_HTML_PATH = resolve(process.cwd(), 'src/index.html');

let mainBuildPromise: Promise<void> | null = null;
let builtMainHtml: string | null = null;

function normalizeMainHtml(source: string): string {
  // Replace the TypeScript entrypoint reference with the compiled output filename.
  const result = source.replace(/src=(["'])\.\/frontend\.tsx\1/, 'src=$1./frontend.js$1');
  if (result === source) {
    console.warn('[WARN] normalizeMainHtml: expected <script src="./frontend.tsx"> was not found in HTML');
  }
  return result;
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
    // Redirect React imports to hono/jsx/dom so AGT components share the
    // same JSX runtime as the app's own hono/jsx/dom code.
    // This is safe because the AGT components used in this codebase (Box,
    // Container, Layout, HighlightOnChange, CharacterSprite) only rely on
    // the subset of React APIs (createElement, hooks) that hono/jsx/dom
    // also implements. AGT-specific React APIs (e.g. createRoot) are never
    // imported in src/; they remain available in console/src/ which has its
    // own separate build.
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
        // Reset so the next request can retry the build.
        mainBuildPromise = null;
        console.error('[ERROR] main frontend build failed', error);
        throw error;
      }
    })();
  }
  return mainBuildPromise;
}

function getMainFrontendAssetPath(pathname: string): string | null {
  // Only serve files (paths with an extension that aren't root-only)
  if (!pathname.includes('.') || pathname.endsWith('/')) return null;
  const resolved = resolve(MAIN_BUILD_PATH, pathname.slice(1));
  // Prevent path traversal: ensure the resolved path is within the build directory.
  // Normalize both paths before comparing to handle any OS-specific separator differences.
  const normalizedBuildPath = resolve(MAIN_BUILD_PATH);
  const normalizedResolved = resolve(resolved);
  if (!normalizedResolved.startsWith(normalizedBuildPath + '/')) return null;
  if (!existsSync(normalizedResolved)) return null;
  return normalizedResolved;
}

function getMainAssetContentType(filePath: string): string | undefined {
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  return undefined;
}

/**
 * Build a stream (SSE/WebSocket) route handler for the given label.
 * Returns an SSE stream when `Accept: text/event-stream` is requested.
 * WebSocket upgrades are handled at the serve.fetch level before Hono.
 */
const makeStreamHandler = (label: string) =>
  (req: Request): Response => {
    const accept = req.headers.get('accept') ?? '';
    try { console.log(`[TRACE] ${label} handler invoked, accept=`, accept, 'upgrade=', req.headers.get('upgrade')); } catch { }
    if (accept.includes('text/event-stream')) {
      return new Response(createSseStream(label), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
        status: 200,
      });
    }
    return new Response('websocket upgrade unavailable', { status: 501 });
  };

// mainServer is assigned synchronously via `const server = mainServer = serve(...)`
// below. Route handlers only run when requests arrive (after the event-loop
// yields), so mainServer is always defined by the time a handler executes.
// The non-null assertion (!) is therefore safe; the runtime check below
// provides an extra guard for unexpected scenarios.
let mainServer!: Bun.Server<WsData>;

const getMainServer = (): Bun.Server<WsData> => {
  if (!mainServer) throw new Error('Server not yet initialized');
  return mainServer;
};

const mainApp = new Hono()
  // Static assets from the public directory
  .get('/nc433974.png', () => new Response(Bun.file('./src/public/nc433974.png')))
  .get('/favicon-32x32.png', () => new Response(Bun.file('./src/public/favicon-32x32.png')))

  // Root HTTP handlers (broadcast/comment ingestion)
  .post('/', (c) => index.POST(c.req.raw, getMainServer().requestIP(c.req.raw)))
  .put('/', async (c) => {
    const res = await index.PUT(c.req.raw, getMainServer().requestIP(c.req.raw));
    if (!res.ok) {
      console.error('response is not ok', res);
      return res;
    }
    const comments = await res.json();
    if (!Array.isArray(comments)) {
      console.error('response data was unprocessed', comments);
      return Response.json({}, { status: 500 });
    }
    agent.postComments(comments);
    broadcastCurrentPayload('onComment');

    if (modelFile) {
      try {
        writeFileSync(modelFile, streamer.talkModel.toJSON());
      } catch (err) {
        console.warn('[WARN]', 'failed to write model', modelFile, err);
      }
    }

    return Response.json({});
  })

  // WebSocket / SSE endpoints
  .get('/api/ws', (c) => makeStreamHandler('/api/ws')(c.req.raw))
  .get('/console/api/ws', (c) => makeStreamHandler('/console/api/ws')(c.req.raw))
  .get('/index.css', async (c) => {
    const css = await compileTailwindCss('src/index.css');
    return createCssResponse(css, c.req.raw);
  })

  // Delegate all /api/* routes to the existing Hono app
  .route('/', apiApp)

  // Serve the built frontend (HTML + JS/CSS assets)
  .all('*', async (c) => handleCatchAll(c.req.raw));

const server = mainServer = serve<WsData>({
  port: portNumber,
  async fetch(req: Request, server: Bun.Server<WsData>) {
    const url = new URL(req.url);
    const isWsEndpoint = url.pathname === '/api/ws' || url.pathname === '/console/api/ws';
    const accept = req.headers.get('accept') ?? '';
    const forceDisableWs = process.env.FORCE_DISABLE_WS_UPGRADE === '1' || process.env.FORCE_DISABLE_WS_UPGRADE === 'true';

    if (isWsEndpoint && !accept.includes('text/event-stream') && !forceDisableWs) {
      const label = url.pathname;
      try { console.log(`[TRACE] ${label} handler invoked, accept=`, accept, 'upgrade=', req.headers.get('upgrade')); } catch { }
      const upgraded = server.upgrade(req, { data: { label } satisfies WsData });
      if (upgraded) {
        // undefined signals Bun that the connection was upgraded to WebSocket
        // and no HTTP response should be sent back.
        return undefined;
      }
      try { console.warn(`[WARN] WebSocket upgrade failed for ${label}`, { upgrade: req.headers.get('upgrade'), secWebSocketKey: req.headers.get('sec-websocket-key') }); } catch {}
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    return mainApp.fetch(req);
  },

  websocket: {
    open(ws) {
      const { label } = ws.data;
      try { console.log(`[INFO] WebSocket client connected (${label})`); } catch { }
      try { wsClients.add(ws); } catch { }
      try { ws.send(JSON.stringify(getCurrentStreamPayload())); } catch { }
    },
    message() { },
    close(ws) { try { wsClients.delete(ws); } catch { } },
  },
});

console.log(`🚀 Server running at ${server.url}`);

let consoleServer: ReturnType<typeof startConsoleServer> | null = null;
if (process.env.NODE_ENV === "production") {
  void (async () => {
    try {
      await Promise.all([
        compileTailwindCss('src/index.css'),
        compileTailwindCss('console/src/index.css'),
      ]);
      console.log('[INFO] Tailwind CSS cache primed');
    } catch (err) {
      console.warn('[WARN] failed to prime Tailwind CSS cache', err);
    }
  })();
}
try {
  consoleServer = startConsoleServer({
    broadcastingHost: process.env.BROADCASTING_HOST ?? '127.0.0.1',
    broadcastingPort: process.env.BROADCASTING_PORT ?? server.port,
  });
  console.log(`🚀 Console running at ${consoleServer.url}`);
} catch (err) {
  const consoleStartupError = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`[ERROR] CONSOLE_STARTUP_FAILED ${JSON.stringify(consoleStartupError)}`);
  process.exit(1);
}

// Start the stream playback after servers are listening so startup is
// responsive for health checks used by tests and CI.
try {
  streamer.play('CookieClicker', readFileSync(dataFile, { encoding: 'utf-8' }));
} catch (err) {
  console.warn('[WARN] streamer.play failed during startup:', err instanceof Error ? err.message : String(err));
}

let running = false;
// Use a classic repeating timer instead of the async iterator-based
// `setInterval` from `node:timers/promises`. The async iterator can
// behave inconsistently in some environments; a standard timer keeps
// the process alive reliably and is sufficient for our needs.
setInterval(async () => {
  if (!running && streamer.speechable) {
    try {
      running = true;
      await streamer.speech();
    } finally {
      running = false;
    }
  }
}, 1_000);

/**
 * @see {@link https://stackoverflow.com/questions/14031763/doing-a-cleanup-action-just-before-node-js-exits}
 */
function exitHandler(options: { cleanup: true; exit?: never } | { cleanup?: never; exit: true }, exitCode?: number) {
  if (options.cleanup) {
    console.log('[INFO]', 'server stopping...');
    if (server) {
      server.stop(options.exit);
    }
    if (consoleServer) {
      consoleServer.stop(options.exit);
    }
  }

  if (typeof exitCode === 'number') {
    process.exitCode = exitCode;
  }

  if (options.exit) {
    process.exit();
  }
}

function signalHandler(options: { cleanup: true; exit?: never } | { cleanup?: never; exit: true }, _: string, exitCode?: number) {
  exitHandler(options, exitCode);
}

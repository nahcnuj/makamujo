// Dynamically import `automated-gameplay-transmitter` at runtime so that
// its internal IPC listeners do not run during module evaluation which
// can cause uncaught exceptions on CI (e.g., named-pipe collisions).
// We'll initialize a fallback agent first and replace it if the import
// and initialization succeed.
import { serve } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
// Use the global `setInterval` timer instead of the Node
// `timers/promises` async iterator. The async iterator can behave
// inconsistently across runtimes; using a classic timer keeps the
// process alive reliably.
import { parseArgs } from "node:util";
import { startConsoleServer } from "./console/index";
import { FallbackTTS, MakaMujo, MarkovChainModel, TTS } from "./lib/server";
import * as index from "./routes/index";
import App from "./src/index.html";
import { handleCatchAll } from "./src/catchAll";
import robotsTxt from "./routes/console/robots.txt";

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
  } catch {}
});
process.on('uncaughtException', (err) => {
  try {
    // Log the exception for diagnostics
    console.error('[UNCAUGHT_EXCEPTION]', err instanceof Error ? err.stack ?? err.message : String(err));
  } catch {}

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
      try { console.log(`[INFO] SSE client connected (${label})`); } catch {}
      ctl = controller;
      sseClients.add(controller);
      try { controller.enqueue(`data: ${JSON.stringify(getCurrentStreamPayload())}\n\n`); } catch {}
    },
    cancel() { if (ctl) { try { sseClients.delete(ctl); } catch {} ctl = undefined; } },
  });
};

const sseBroadcast = (payload: unknown) => {
  if (sseClients.size === 0) return;
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  try { console.log('[INFO] sseBroadcast -> sseClients count=', sseClients.size); } catch {}
  for (const controller of Array.from(sseClients)) {
    try {
      // Evict clients under backpressure (desiredSize <= 0) to avoid blocking
      // the event loop when a slow or unread connection fills its TCP send buffer.
      // null means the stream is already closed/errored; treat that like healthy.
      if ((controller.desiredSize ?? 1) <= 0) {
        try { controller.close(); } catch {}
        sseClients.delete(controller);
        continue;
      }
      controller.enqueue(frame);
    } catch (err) {
      try { controller.close(); } catch {}
      try { sseClients.delete(controller); } catch {}
    }
  }
};

const broadcastToWsClients = (payload: unknown) => {
  const message = JSON.stringify(payload);
  for (const ws of Array.from(wsClients)) {
    try {
      ws.send(message);
    } catch (err) {
      try { ws.close(); } catch {}
      try { wsClients.delete(ws); } catch {}
    }
  }
};

const broadcastCurrentPayload = (context: string) => {
  try {
    sseBroadcast(getCurrentStreamPayload());
  } catch (err) {
    console.warn(`[WARN] failed to broadcast to SSE clients (${context}):`, err instanceof Error ? err.message : String(err));
  }
};

const getCurrentStreamPayload = () => {
  const agentStreamState = agent.getStreamState?.();
  const streamState = (lastPublishedStreamState === undefined || lastPublishedStreamState === null)
    ? agentStreamState
    : lastPublishedStreamState;
  const base = streamState && typeof streamState === 'object' ? (streamState as any) : {};
  return {
    niconama: base.niconama ?? {},
    canSpeak: base.canSpeak ?? streamer.canSpeak,
    currentGame: base.currentGame ?? streamer.currentGame ?? null,
    nGram: base.nGram ?? streamer.currentNGramSize,
    nGramRaw: base.nGramRaw ?? streamer.currentNGramSizeRaw,
    speech: base.speech ?? agent.getSpeech(),
    speechHistory: base.speechHistory ?? generatedSpeechHistory,
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
  postComments: (_: unknown) => {},
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
// Keep only a recent window to avoid unbounded in-memory growth while keeping enough context for console operations.
const GENERATED_SPEECH_HISTORY_MAX_LENGTH = 20;
const generatedSpeechHistory: Array<{ id: string; speech: string; nGram?: number; nGramRaw?: number; nodes?: string[] }> = [];
let generatedSpeechHistorySequence = 0;

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
  if (generatedSpeechHistory.length > GENERATED_SPEECH_HISTORY_MAX_LENGTH) {
    generatedSpeechHistory.length = GENERATED_SPEECH_HISTORY_MAX_LENGTH;
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

const server = serve({
  port: portNumber,
  routes: {
    // Serve nc433974.png from the public directory.
    '/nc433974.png': new Response(Bun.file('./src/public/nc433974.png')),

    // Serve favicon from the public directory.
    '/favicon-32x32.png': new Response(Bun.file('./src/public/favicon-32x32.png')),

    '/': {
      ...index,
      PUT: async (req, server) => {
        const res = await index.PUT(req, server);
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

        if (modelFile) {
          try {
            writeFileSync(modelFile, streamer.talkModel.toJSON());
          } catch (err) {
            console.warn('[WARN]', 'failed to write model', modelFile, err);
          }
        }

        return Response.json({});
      },
    },

    '/api/speech': async () => {
      const speechState = agent.getSpeech();
      return Response.json({
        speech: normalizeSpeechText(speechState) ?? '',
        silent: !!(speechState && typeof speechState === 'object' ? (speechState as any).silent : false),
      });
    },

    '/api/game': async () => {
      return Response.json(agent.getGame() ?? {});
    },

    '/api/meta': {
      GET: () => {
        // Prefer the last published stream state when present (tests POST to
        // /api/meta). If no published state exists, fall back to the external
        // agent's in-memory state so normal runtime still works.
        const agentStreamState = agent.getStreamState?.();
        const streamState = (lastPublishedStreamState === undefined || lastPublishedStreamState === null)
          ? agentStreamState
          : lastPublishedStreamState;
        console.log('[INFO] GET /api/meta ->', JSON.stringify(streamState));
        const base = streamState && typeof streamState === 'object' ? (streamState as any) : {};
        const responsePayload = {
          niconama: base.niconama ?? {},
          canSpeak: base.canSpeak ?? streamer.canSpeak,
          currentGame: base.currentGame ?? streamer.currentGame ?? null,
          nGram: base.nGram ?? streamer.currentNGramSize,
          nGramRaw: base.nGramRaw ?? streamer.currentNGramSizeRaw,
          speech: base.speech ?? agent.getSpeech(),
          speechHistory: base.speechHistory ?? generatedSpeechHistory,
        } as const;
        console.log('[INFO] GET /api/meta response ->', JSON.stringify(responsePayload));
        return Response.json(responsePayload);
      },
      POST: async (req) => {
        try {
          let body: any;
          try {
            body = await req.json();
          } catch (err) {
            console.warn('[WARN] POST /api/meta failed to parse JSON body:', err instanceof Error ? err.message : String(err));
            return Response.json({}, { status: 400 });
          }

          let published = body.data ?? body;

          // Normalize legacy stream payloads of the form { type: 'niconama', data: {...} }
          // into the internal shape expected by getCurrentStreamPayload().
          try {
            if (published && typeof published === 'object' && 'type' in published && published.type === 'niconama') {
              const d = published.data ?? {};
              published = {
                niconama: {
                  type: d.isLive ? 'live' : 'offline',
                  meta: {
                    title: d.title ?? undefined,
                    url: d.url ?? undefined,
                    start: d.startTime ?? undefined,
                    total: {
                      listeners: typeof d.total === 'number' ? d.total : undefined,
                      gift: d.points?.gift ?? undefined,
                      ad: d.points?.ad ?? undefined,
                      comments: undefined,
                    },
                  },
                },
              } as const;
            }
          } catch (err) {
            console.warn('[WARN] failed to normalize published stream state:', err instanceof Error ? err.message : String(err));
          }

          // Persist the published stream state so GET /api/meta reflects it.
          try {
            lastPublishedStreamState = published;
          } catch (err) {
            console.warn('[WARN] failed to persist published stream state locally:', err instanceof Error ? err.message : String(err));
          }

          // Notify connected WS and SSE clients about the new published state.
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

          try { console.log('[INFO] POST /api/meta -> sseClients=', sseClients.size, 'wsClients=', wsClients.size); } catch {}

          return Response.json({});
        } catch (err) {
          console.error('[ERROR] POST /api/meta handler crashed:', err instanceof Error ? err.stack ?? err.message : String(err));
          return Response.json({}, { status: 500 });
        }
      },
    },

    // WebSocket / SSE endpoints for console clients to subscribe to live
    // agent state. Support both EventStream (SSE) and WebSocket upgrades.
    '/api/ws': {
      GET: (req: Request) => {
        const accept = req.headers.get('accept') ?? '';
        try { console.log('[TRACE] /api/ws handler invoked, accept=', accept, 'upgrade=', req.headers.get('upgrade')); } catch {}
        if (accept.includes('text/event-stream')) {
          return new Response(createSseStream('/api/ws'), {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'Access-Control-Allow-Origin': '*',
            },
            status: 200,
          });
        }

        try {
          if (process.env.FORCE_DISABLE_WS_UPGRADE === '1' || process.env.FORCE_DISABLE_WS_UPGRADE === 'true') {
            return new Response('websocket upgrade unavailable', { status: 501 });
          }
          const upgraded = (Bun as any).upgradeWebSocket(req, {
            open(ws: any) {
              try { console.log('[INFO] WebSocket client connected (/api/ws)'); } catch {}
              try { wsClients.add(ws); } catch {}
              try { ws.send(JSON.stringify(getCurrentStreamPayload())); } catch {}
            },
            message() {},
            close(ws: any) { try { wsClients.delete(ws); } catch {} },
            error(ws: any) { try { wsClients.delete(ws); } catch {} },
          });
          return upgraded.response;
        } catch (err) {
          return new Response('WebSocket upgrade failed', { status: 400 });
        }
      },
    },

    '/console/api/ws': {
      GET: (req: Request) => {
        const accept = req.headers.get('accept') ?? '';
        try { console.log('[TRACE] /console/api/ws handler invoked, accept=', accept, 'upgrade=', req.headers.get('upgrade')); } catch {}
        if (accept.includes('text/event-stream')) {
          return new Response(createSseStream('/console/api/ws'), {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'Access-Control-Allow-Origin': '*',
            },
            status: 200,
          });
        }

        try {
          if (process.env.FORCE_DISABLE_WS_UPGRADE === '1' || process.env.FORCE_DISABLE_WS_UPGRADE === 'true') {
            return new Response('websocket upgrade unavailable', { status: 501 });
          }
          const upgraded = (Bun as any).upgradeWebSocket(req, {
            open(ws: any) {
              try { console.log('[INFO] WebSocket client connected (/console/api/ws)'); } catch {}
              try { wsClients.add(ws); } catch {}
              try { ws.send(JSON.stringify(getCurrentStreamPayload())); } catch {}
            },
            message() {},
            close(ws: any) { try { wsClients.delete(ws); } catch {} },
            error(ws: any) { try { wsClients.delete(ws); } catch {} },
          });
          return upgraded.response;
        } catch (err) {
          return new Response('WebSocket upgrade failed', { status: 400 });
        }
      },
    },

    '/console/robots.txt': robotsTxt,

    // Serve the application HTML via Bun's HTML import so Bun can rewrite
    // and resolve module imports (safe, local resolution without external CDN).
    '/*': App,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);

let consoleServer: ReturnType<typeof startConsoleServer> | null = null;
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

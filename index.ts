// Dynamically import `automated-gameplay-transmitter` at runtime so that
// its internal IPC listeners do not run during module evaluation which
// can cause uncaught exceptions on CI (e.g., named-pipe collisions).
// We'll initialize a fallback agent first and replace it if the import
// and initialization succeed.
import { serve } from "bun";
import { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Use the global `setInterval` timer instead of the Node
// `timers/promises` async iterator. The async iterator can behave
// inconsistently across runtimes; using a classic timer keeps the
// process alive reliably.
import { parseArgs } from "node:util";
import { startConsoleServer } from "./console/index";
import * as consoleRoutes from './routes/console/index';
import { getResilientProxyControllers } from './lib/console-proxy';
import { FallbackTTS, MakaMujo, MarkovChainModel, TTS } from "./lib/server";
import { AllowedIP } from "./lib/allowedIP";
import * as speechHistoryRoute from "./routes/api/speech-history";
import type { SpeechHistoryEntry } from "./routes/api/speech-history";
import { handleCatchAll } from "./src/frontendServer";
import { compileTailwindCss, createCssResponse } from "./lib/tailwind";
import { normalizePublishedStreamState, resolveNiconamaFromState } from "./lib/streamState";
import { createNiconamaCommentClient, filterAgentCommentsWithText, getCommentTextFromAgentComment, type NiconamaCommentClient } from "./lib/niconamaCommentClient";
import { installConsoleLogger } from "./lib/consoleLogger";

const console = installConsoleLogger();
let server: Bun.Server<unknown> | null = null;
let consoleServer: ReturnType<typeof startConsoleServer> | null = null;
let niconamaCommentClient: NiconamaCommentClient | null = null;

// Console server will be started after the main server is initialized
// so that the broadcasting port can be passed to the console proxy.

process.on('exit', exitHandler.bind(null, { cleanup: true }));
process.on('SIGINT', signalHandler.bind(null, { exit: true }));
process.on('SIGUSR1', signalHandler.bind(null, { exit: true }));
process.on('SIGUSR2', signalHandler.bind(null, { exit: true }));
// Log uncaught exceptions for better diagnostics before invoking the
// existing exit handler which terminates the process.

// Safe references used by the global exit handler to avoid accessing
// variables that may still be in the temporal dead zone during early
// startup failures. These are assigned once the corresponding resources
// have been initialized.
let __serverForExit: any = null;
let __consoleServerForExit: any = null;

// Console server already started above; skip repeated initialization.

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

const PROJECT_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));

const { values: {
  model: modelFileArg,
  data: dataFileArg,
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

const modelFile = resolve(PROJECT_ROOT, modelFileArg);
const dataFile = resolve(PROJECT_ROOT, dataFileArg);

// Rely on Bun's `--hot` and Bun.build watch mode in development.

const model = (file => {
  try {
    return MarkovChainModel.fromFile(file);
  } catch (err) {
    console.warn('failed to open the file', file);
    return new MarkovChainModel();
  }
})(modelFile);

// Streamer instance used throughout the server. Use the fallback TTS
// implementation initially; this may be replaced by an external agent
// integration later if available.
const streamer = new MakaMujo(model, new FallbackTTS());

// Global stream state and client registries used by SSE/WS endpoints.
let lastPublishedStreamState: unknown = undefined;
// Mirror published state on globalThis so callbacks from other async
// modules can access it even if module evaluation order differs.
(globalThis as any).__lastPublishedStreamState = (globalThis as any).__lastPublishedStreamState ?? lastPublishedStreamState;
const wsClients = new Set<any>();
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const sseEncoder = new TextEncoder();

function createSseStream(_label: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
        sseClients.add(controller);
        try { console.debug('[DIAG] SSE client connected, total=', sseClients.size); } catch {}
        try { controller.enqueue(sseEncoder.encode(': connected\n\n')); } catch {}
        try {
          const payload = getCurrentStreamPayload();
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify(payload ?? {})}\n\n`));
          // If the initial payload lacks `niconama`, schedule a couple of
          // retransmits shortly after connect to give async upstream
          // callbacks time to populate published state (mirrors WS logic).
          try {
            if (payload && typeof payload === 'object' && !(payload as any).niconama) {
              setTimeout(() => {
                try { controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify(getCurrentStreamPayload() ?? {})}\n\n`)); } catch {}
              }, 250);
              setTimeout(() => {
                try { controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify(getCurrentStreamPayload() ?? {})}\n\n`)); } catch {}
              }, 1000);
            }
          } catch {}
        } catch {}
    },
    cancel() {
      // Remove any controllers that are closed or canceled.
        try { sseClients.forEach((c) => { try { if ((c as any).desiredSize === null) sseClients.delete(c); } catch {} }); } catch {}
        try { console.debug('[DIAG] SSE client disconnected, total=', sseClients.size); } catch {}
    },
  });
}

function sseBroadcast(payload: unknown) {
  const data = JSON.stringify(payload ?? {});
  const chunk = sseEncoder.encode(`data: ${data}\n\n`);
  try { console.debug('[DIAG] sseBroadcast payload keys ->', Object.keys((payload && typeof payload === 'object') ? payload as any : {}), 'hasNiconama=', !!(payload && typeof payload === 'object' && (payload as any).niconama)); } catch {}
  for (const c of Array.from(sseClients)) {
    try {
      c.enqueue(chunk);
    } catch (err) {
      try { sseClients.delete(c); } catch {}
    }
  }
  try {
    const resilient = getResilientProxyControllers();
    for (const c of Array.from(resilient)) {
      try {
        if ((c as any).desiredSize === null) {
          try { resilient.delete(c); } catch {}
          continue;
        }
        c.enqueue(chunk);
      } catch (err) {
        try { resilient.delete(c); } catch {}
      }
    }
  } catch {}
}

// Expose SSE broadcaster for external callers (tests, agents) to invoke.
(globalThis as any).__sseBroadcast = sseBroadcast;

const broadcastToWsClients = (payload: unknown) => {
  const message = JSON.stringify(payload);
  try { console.debug('[DIAG] broadcastToWsClients sending keys ->', Object.keys((payload && typeof payload === 'object') ? payload as any : {}), 'hasNiconama=', !!(payload && typeof payload === 'object' && (payload as any).niconama)); } catch {}
  for (const ws of Array.from(wsClients)) {
    try {
      ws.send(message);
    } catch (err) {
      try { ws.close(); } catch { }
      try { wsClients.delete(ws); } catch { }
    }
  }
};

// Expose WS broadcaster as well for external callers.
(globalThis as any).__broadcastToWsClients = broadcastToWsClients;

const broadcastCurrentPayload = (context: string) => {
  try {
    const payload = getCurrentStreamPayload();
    sseBroadcast(payload);
    broadcastToWsClients(payload);
  } catch (err) {
    console.warn(`[WARN] failed to broadcast to clients (${context}):`, err instanceof Error ? err.message : String(err));
  }
};


// Current speech state exposed to the console agent API.
let currentSpeechState: { speech: string; silent: boolean } | undefined = undefined;

let agent: any = {
  setSpeech: (text: string) => { currentSpeechState = { speech: text, silent: false }; },
  getSpeech: () => currentSpeechState,
  getGame: () => null,
  getStreamState: () => lastPublishedStreamState,
  publishStreamState: (data: unknown) => { lastPublishedStreamState = data; },
  postComments: (comments: unknown) => {
    try {
      // Forward received comments to the internal streamer so the agent
      // can learn and speak in response. `streamer.listen` accepts an
      // array of AgentComment objects.
      if (Array.isArray(comments)) {
        streamer.listen(comments as any);
      } else if (comments) {
        streamer.listen([comments] as any);
      }
    } catch (e) {
      // swallow errors in the fallback to avoid crashing startup
    }
  },
};

const getCurrentStreamPayload = () => {
  const agentStreamState = agent.getStreamState?.();
  // Prefer the locally tracked published state, but fall back to any
  // `globalThis` mirror (set by other modules) to handle cross-module
  // initialization ordering where the global may have been written but
  // the local variable has not yet been updated.
  const globalPublished = (globalThis as any).__lastPublishedStreamState;
  const streamState = (lastPublishedStreamState === undefined || lastPublishedStreamState === null)
    ? (globalPublished ?? agentStreamState)
    : lastPublishedStreamState;
  const normalizedStreamState = normalizePublishedStreamState(streamState);
  const base = normalizedStreamState && typeof normalizedStreamState === 'object' ? (normalizedStreamState as any) : {};
  const normalizedAgentStreamState = normalizePublishedStreamState(agentStreamState);
  const agentBase = normalizedAgentStreamState && typeof normalizedAgentStreamState === 'object'
    ? (normalizedAgentStreamState as any)
    : {};
  const replyTargetComment = base.replyTargetComment && typeof base.replyTargetComment === 'object'
    ? base.replyTargetComment
    : agentBase.replyTargetComment && typeof agentBase.replyTargetComment === 'object'
      ? agentBase.replyTargetComment
      : undefined;
  const tryResolveNiconama = (src: unknown) => {
    const resolved = resolveNiconamaFromState(src as any) as any;
    if (resolved && typeof resolved === "object" && Object.keys(resolved).length > 0) return resolved;
    return undefined;
  };

  // Prefer published payload but fall back to the agent's internal
  // stream state or the streamer's state so consumers receive useful
  // metadata instead of `{}` or an empty/omitted field.
  const niconamaFromPublished = tryResolveNiconama(base);
  const niconamaFromAgent = tryResolveNiconama(agentBase);
  const niconamaFromStreamer = tryResolveNiconama(streamer.streamState);
  const niconamaFinal = niconamaFromPublished ?? niconamaFromAgent ?? niconamaFromStreamer ?? undefined;

  const explicitSpeechHistory = Array.isArray(base.speechHistory) && base.speechHistory.length > 0
    ? base.speechHistory
    : generatedSpeechHistory;

  speechHistoryRoute.setSpeechHistoryRef(explicitSpeechHistory);

  const payload = {
    niconama: niconamaFinal,
    canSpeak: base.canSpeak ?? streamer.canSpeak,
    currentGame: base.currentGame ?? streamer.currentGame ?? null,
    nGram: base.nGram ?? streamer.currentNGramSize,
    nGramRaw: base.nGramRaw ?? streamer.currentNGramSizeRaw,
    speech: base.speech ?? agent.getSpeech(),
    speechHistory: explicitSpeechHistory.slice(0, GENERATED_SPEECH_HISTORY_SSE_SIZE),
    replyTargetComment,
    commentCount: base.commentCount ?? streamer.streamState?.meta?.total?.comments,
  } as const;

  // Expose a local shortcut so other modules (console proxy) can request the
  // current payload without performing an HTTP fetch which may race with
  // in-flight published state updates.
  try { (globalThis as any).__getCurrentStreamPayload = getCurrentStreamPayload; } catch {}

  return payload;
};

const extractReplyTargetComment = (payload: unknown): unknown => {
  if (payload && typeof payload === 'object' && 'replyTargetComment' in payload) {
    return (payload as any).replyTargetComment;
  }
  const nestedData = payload && typeof payload === 'object' && 'data' in payload ? (payload as any).data : undefined;
  if (nestedData && typeof nestedData === 'object' && 'replyTargetComment' in nestedData) {
    return nestedData.replyTargetComment;
  }
  return undefined;
};

const handlePublishedStreamState = (payload: unknown): void => {
  try { console.debug('[DIAG] handlePublishedStreamState invoked with payload ->', payload && typeof payload === 'object' ? Object.keys(payload as any) : String(payload)); } catch {}
  const replyTargetComment = extractReplyTargetComment(payload);
  let published: unknown = payload;

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
    // Merge with existing published state so transient external updates
    // (e.g. automatic niconama client updates) do not unintentionally
    // remove explicit fields posted by clients. New `published` values
    // take precedence.
    try {
      const prev = lastPublishedStreamState && typeof lastPublishedStreamState === 'object' ? (lastPublishedStreamState as any) : {};
      const next = published && typeof published === 'object' ? (published as any) : {};
      // Normalize the incoming published payload to determine any `niconama`
      // metadata it implies (e.g. top-level title/url/start -> niconama.meta).
      const normalizedNext = normalizePublishedStreamState(next) as any;

      // Start with a shallow merge, but ensure that any `niconama` produced
      // from the new payload takes precedence over the previous `niconama`.
      const merged: any = { ...prev, ...next };
      if (normalizedNext && typeof normalizedNext === 'object' && 'niconama' in normalizedNext) {
        merged.niconama = normalizedNext.niconama;
      } else {
        // If the normalized next didn't yield a `niconama` field, attempt to
        // derive one from top-level title/url/start fields so client-posted
        // metadata overrides previous nested `niconama` values.
        try {
          const derived = resolveNiconamaFromState(next) as any;
          if (derived && typeof derived === 'object' && Object.keys(derived).length > 0) {
            merged.niconama = derived;
          }
        } catch {}

        // Extra safeguard: if the incoming payload had explicit top-level
        // title/url/start fields, prefer those values unconditionally so a
        // client posting these fields cannot be overridden by prior state.
        try {
          const hasTopLevel = next && typeof next === 'object' && (
            typeof (next as any).title === 'string' ||
            typeof (next as any).url === 'string' ||
            typeof (next as any).start === 'number' ||
            typeof (next as any).startTime === 'number'
          );
          if (hasTopLevel) {
            const forced = resolveNiconamaFromState(next) as any;
            if (forced && typeof forced === 'object' && Object.keys(forced).length > 0) {
              merged.niconama = forced;
            }
          }
        } catch {}
      }

      // Ensure any nested `niconama` stored in the published state includes
      // a normalized `meta` object when possible. This makes downstream
      // consumers (SSE/WS clients) receive promoted metadata immediately
      // without relying on runtime normalization in `getCurrentStreamPayload`.
      try {
        if (merged && typeof merged === 'object' && 'niconama' in merged) {
          const resolved = resolveNiconamaFromState({ niconama: merged.niconama }) as any;
          if (resolved && typeof resolved === 'object' && Object.keys(resolved).length > 0) {
            merged.niconama = resolved;
          }
        }
      } catch {}

      lastPublishedStreamState = merged;
      try { (globalThis as any).__lastPublishedStreamState = merged; } catch {}
      try { console.debug('[DIAG] lastPublishedStreamState updated ->', merged && typeof merged === 'object' ? Object.keys(merged as any) : String(merged), 'niconamaKeys=', merged && typeof merged === 'object' && (merged as any).niconama ? Object.keys((merged as any).niconama) : undefined); } catch {}
    } catch (mergeErr) {
      // Fallback to direct assignment if merge fails for unexpected types.
      lastPublishedStreamState = published;
      try { (globalThis as any).__lastPublishedStreamState = published; } catch {}
      try { console.debug('[DIAG] lastPublishedStreamState updated ->', published && typeof published === 'object' ? Object.keys(published as any) : String(published)); } catch {}
    }
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
let externalAgentInitialized = false;

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
        externalAgentInitialized = true;
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
if (!Number.isFinite(portNumber) || portNumber < 0 || portNumber > 65535) {
  console.error(`Invalid port: ${port}. Must be an integer between 0 and 65535.`);
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
    try { console.log('[DEBUG] GET /api/meta invoked'); } catch {}
    try {
      const payload = getCurrentStreamPayload();
      try { console.log('[DEBUG] GET /api/meta payload ->', { keys: Object.keys(payload || {}) }); } catch {}
      return Response.json(payload);
    } catch (err) {
      try { console.error('[ERROR] GET /api/meta failed to produce JSON payload:', err instanceof Error ? err.stack ?? err.message : String(err)); } catch {}
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    }
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

      handlePublishedStreamState(body);
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
      'react/jsx-dev-runtime': 'hono/jsx/dom/jsx-dev-runtime',
      'hono/jsx': 'hono/jsx/dom',
      'hono/jsx/jsx-runtime': 'hono/jsx/dom/jsx-runtime',
      'hono/jsx/jsx-dev-runtime': 'hono/jsx/dom/jsx-dev-runtime',
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
    try { console.debug(`[DEBUG] ${label} handler invoked, accept=`, accept, 'upgrade=', req.headers.get('upgrade')); } catch { }
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

const mainApp = new Hono()
  // Static assets from the public directory
  .get('/nc433974.png', () => new Response(Bun.file('./src/public/nc433974.png')))
  .get('/favicon-32x32.png', () => new Response(Bun.file('./src/public/favicon-32x32.png')))
  .post('/', () => new Response(null, { status: 404 }))
  .put('/', () => new Response(null, { status: 404 }))

  // WebSocket / SSE endpoints
  .get('/api/ws', (c) => makeStreamHandler('/api/ws')(c.req.raw))
  // Delegate /console/api/ws to the console routes so the proxy logic
  // (including upstream probing and resilient SSE proxying) executes
  // using the console module's helper functions.
  .get('/console/api/ws', (c) => consoleRoutes.app.fetch(c.req.raw))
  .get('/index.css', async (c) => {
    const css = await compileTailwindCss('src/index.css');
    return createCssResponse(css, c.req.raw);
  })

  // Delegate all /api/* routes to the existing Hono app
  .route('/', apiApp)

  // Serve the built frontend (HTML + JS/CSS assets)
  .all('*', async (c) => handleCatchAll(c.req.raw));

const serverInstance: any = serve<WsData>({
  port: portNumber,
  async fetch(req: Request, server: Bun.Server<WsData>): Promise<Response | undefined> {
    const url = new URL(req.url);
    const isWsEndpoint = url.pathname === '/api/ws' || url.pathname === '/console/api/ws';
    const accept = req.headers.get('accept') ?? '';
    const forceDisableWs = process.env.FORCE_DISABLE_WS_UPGRADE === '1' || process.env.FORCE_DISABLE_WS_UPGRADE === 'true';

    if (isWsEndpoint && !accept.includes('text/event-stream') && !forceDisableWs) {
      const label = url.pathname;
      try { console.debug(`[DEBUG] ${label} handler invoked, accept=`, accept, 'upgrade=', req.headers.get('upgrade')); } catch { }
      const upgraded = server.upgrade(req, { data: { label } satisfies WsData });
      if (upgraded) {
        // undefined signals Bun that the connection was upgraded to WebSocket
        // and no HTTP response should be sent back.
        return undefined;
      }
    }

    return mainApp.fetch(req);
  },
  websocket: {
    open(ws) {
      const { label } = ws.data;
      try { console.log(`[INFO] WebSocket client connected (${label})`); } catch { }
      try { wsClients.add(ws); } catch { }
      try {
        const payload = getCurrentStreamPayload();
        try { ws.send(JSON.stringify(payload)); } catch {}

        // If the initial payload lacks `niconama`, resend shortly after
        // to give async upstream callbacks time to populate published state.
        if (payload && typeof payload === 'object' && !(payload as any).niconama) {
          setTimeout(() => {
            try { ws.send(JSON.stringify(getCurrentStreamPayload())); } catch {}
          }, 250);
          // Second attempt in case upstream callbacks are slower.
          setTimeout(() => {
            try { ws.send(JSON.stringify(getCurrentStreamPayload())); } catch {}
          }, 1000);
        }
      } catch { }
    },
    message() { },
    close(ws) { try { wsClients.delete(ws); } catch { } },
  },
});
server = serverInstance as any;
__serverForExit = serverInstance as any;
const serverUrl = String(serverInstance.url).replace(/\/+$|^\s+|\s+$/g, '');
console.log(`🚀 Server running at ${serverUrl}`);

// Start the console server now that the broadcasting server port is known
try {
  consoleServer = startConsoleServer({
    broadcastingHost: process.env.BROADCASTING_HOST ?? '127.0.0.1',
    broadcastingPort: process.env.BROADCASTING_PORT ?? serverInstance.port,
  });
  const consoleUrl = String(consoleServer.url).replace(/\/+$|^\s+|\s+$/g, '');
  console.log(`🚀 Console running at ${consoleUrl}`);
  __consoleServerForExit = consoleServer;
  if (process.env.NODE_ENV === 'production') {
    AllowedIP.set({ family: 'IPv4', address: '127.0.0.1' });
  }
} catch (err) {
  console.warn('[WARN] failed to start console server:', err instanceof Error ? err.message : String(err));
}

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


const NICONAMA_WATCH_URL = process.env.NICONAMA_WATCH_URL ?? process.env.NICONAMA_TEST_WATCH_URL;
const NICONAMA_USER_DATA_DIR = process.env.NICONAMA_USER_DATA_DIR ?? './playwright/.auth/';
const NICONAMA_CHROMIUM_EXECUTABLE_PATH = process.env.CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium';
const DEBUG_NICONAMA_COMMENTS = process.env.DEBUG_NICONAMA_COMMENTS === '1';

const createNiconamaClientOptions = () => {
  const options: any = {
    userDataDir: NICONAMA_USER_DATA_DIR,
    executablePath: NICONAMA_CHROMIUM_EXECUTABLE_PATH,
    pollIntervalMs: 30_000,
  };
  if (typeof NICONAMA_WATCH_URL === 'string' && NICONAMA_WATCH_URL.length > 0) {
    options.watchUrl = NICONAMA_WATCH_URL;
  }
  return options;
};

const handleNiconamaComments = (comments: unknown) => {
  const filteredComments = filterAgentCommentsWithText(comments as any);
  if (DEBUG_NICONAMA_COMMENTS) {
    for (const comment of filteredComments) {
      const text = getCommentTextFromAgentComment(comment);
      if (text) {
        console.log('[NICONAMA COMMENT]', text);
      }
    }
  }
  if (filteredComments.length > 0) {
    try {
      agent.postComments(filteredComments);
    } catch (err) {
      console.warn('[WARN] agent.postComments threw:', err instanceof Error ? err.message : String(err));
    }
  }

  try {
    const afterState = typeof agent.getStreamState === 'function' ? agent.getStreamState() : undefined;
    const hasCount = afterState && typeof afterState === 'object' && typeof (afterState as any).commentCount === 'number';
    if (!hasCount) {
      const payload = getCurrentStreamPayload();
      const currentCount = typeof payload.commentCount === 'number' ? payload.commentCount : 0;
      const increment = Array.isArray(comments) ? comments.length : 0;
      const newCount = currentCount + increment;

      lastPublishedStreamState = (lastPublishedStreamState && typeof lastPublishedStreamState === 'object') ? { ...lastPublishedStreamState } : {};
      try {
        (lastPublishedStreamState as any).commentCount = newCount;
      } catch {}

      try {
        if (!(lastPublishedStreamState as any).niconama || typeof (lastPublishedStreamState as any).niconama !== 'object') {
          (lastPublishedStreamState as any).niconama = { meta: { total: { comments: newCount } } };
        } else {
          const meta = (lastPublishedStreamState as any).niconama.meta = (lastPublishedStreamState as any).niconama.meta ?? {};
          meta.total = meta.total ?? {};
          meta.total.comments = newCount;
        }
      } catch {}
    }
  } catch (err) {
    console.warn('[WARN] failed to update fallback commentCount:', err instanceof Error ? err.message : String(err));
  }

  broadcastCurrentPayload('onComment');
  if (modelFile) {
    try {
      writeFileSync(modelFile, streamer.talkModel.toJSON());
    } catch (err) {
      console.warn('[WARN]', 'failed to write model', modelFile, err);
    }
  }
};

const createNiconamaCommentClientIfNeeded = () => {
  return createNiconamaCommentClient(
    createNiconamaClientOptions(),
    {
      onMeta: handlePublishedStreamState,
      onComments: handleNiconamaComments,
      onError: (err) => {
        console.warn('[WARN] niconama comment client error:', err instanceof Error ? err.message : String(err));
      },
    },
  );
};

// Defer creation/start of the niconama client until after servers are
// responsive. A retry loop with backoff handles transient Playwright
// navigation failures seen in CI (e.g., slow page load or timeouts).
try {
  const startDelayMs = Number(process.env.NICONAMA_START_DELAY_MS ?? '350');
  const maxRetries = Number(process.env.NICONAMA_START_MAX_RETRIES ?? '3');
  setTimeout(async () => {
    let attempt = 0;
    while (attempt < maxRetries) {
      attempt += 1;
      try {
        niconamaCommentClient = createNiconamaCommentClientIfNeeded();
        await niconamaCommentClient.start();
        console.info('[INFO] niconamaCommentClient started successfully', { watchUrl: NICONAMA_WATCH_URL ?? 'unset' });
        break;
      } catch (err) {
        console.warn('[WARN] niconamaCommentClient start attempt failed:', err instanceof Error ? err.message : String(err), 'attempt=', attempt);
        if (attempt >= maxRetries) {
          console.warn('[WARN] reached max retries for niconama start; giving up for now');
          break;
        }
        const backoff = 500 * attempt;
        await new Promise((res) => setTimeout(res, backoff));
      }
    }
  }, startDelayMs);
} catch (err) {
  console.warn('[WARN] failed to schedule niconamaCommentClient delayed start:', err instanceof Error ? err.message : String(err));
}

// Small startup delay before launching the external nicovideo comment client.
// This reduces a race where the client's callbacks run before broadcasting
// helpers and mirrored state are fully initialized, causing initial payloads
// sent to newly-connected clients to omit `niconama` intermittently in E2E.
try {
  const startDelayMs = Number(process.env.NICONAMA_START_DELAY_MS ?? '350');
  setTimeout(() => {
    try {
      if (!niconamaCommentClient) {
        niconamaCommentClient = createNiconamaCommentClientIfNeeded();
        void niconamaCommentClient.start().catch((err) => {
          console.warn('[WARN] failed to start delayed niconamaCommentClient:', err instanceof Error ? err.message : String(err));
        });
      }
    } catch (err) {
      console.warn('[WARN] delayed niconamaCommentClient init failed:', err instanceof Error ? err.message : String(err));
    }
  }, startDelayMs);
} catch (err) {
  // If the delay setup fails for any reason, log and continue.
  console.warn('[WARN] failed to schedule niconamaCommentClient delayed start:', err instanceof Error ? err.message : String(err));
}

// Start the stream playback after servers are listening so startup is
// responsive for health checks used by tests and CI.
try {
  streamer.play('CookieClicker', readFileSync(dataFile, { encoding: 'utf-8' }), { savePath: dataFile });
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
    try {
      if (__serverForExit) {
        __serverForExit.stop(options.exit);
      }
    } catch (err) {
      // ignore errors while attempting to stop the server during cleanup
    }
    try {
      if (__consoleServerForExit) {
        __consoleServerForExit.stop(options.exit);
      }
    } catch (err) {
      // ignore console stop errors
    }
    if (niconamaCommentClient) {
      void niconamaCommentClient.stop().catch((err) => {
        console.warn('[WARN] failed to stop niconamaCommentClient:', err instanceof Error ? err.message : String(err));
      });
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

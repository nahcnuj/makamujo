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
const generatedSpeechHistory: Array<{ id: string; speech: string; nGram: number; nGramRaw: number }> = [];
let generatedSpeechHistorySequence = 0;

let clearSpeechTimer: ReturnType<typeof setTimeout> | undefined = undefined;

streamer.onSpeech(async (text) => {
  generatedSpeechHistorySequence += 1;
  generatedSpeechHistory.unshift({
    id: `speech-${generatedSpeechHistorySequence}`,
    speech: text,
    nGram: streamer.currentNGramSize,
    nGramRaw: streamer.currentNGramSizeRaw,
  });
  if (generatedSpeechHistory.length > GENERATED_SPEECH_HISTORY_MAX_LENGTH) {
    generatedSpeechHistory.length = GENERATED_SPEECH_HISTORY_MAX_LENGTH;
  }
  if (clearSpeechTimer) {
    clearTimeout(clearSpeechTimer);
    clearSpeechTimer = undefined;
  }
  agent.setSpeech(text);
});

streamer.onSpeechComplete(async () => {
  if (clearSpeechTimer) {
    clearTimeout(clearSpeechTimer);
  }
  clearSpeechTimer = setTimeout(() => {
    const speechState = agent.getSpeech();
    if (!speechState.silent) {
      agent.setSpeech('');
    }
    clearSpeechTimer = undefined;
  }, 1000);
});

streamer.play('CookieClicker', readFileSync(dataFile, { encoding: 'utf-8' }));

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

    // Serve index.html for all unmatched routes.
    '/*': App,

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
      return Response.json(agent.getSpeech());
    },

    '/api/game': async () => {
      return Response.json(agent.getGame() ?? {});
    },

    '/api/meta': {
      GET: () => {
        const streamState = agent.getStreamState();
        console.debug('[DEBUG] GET /api/meta ->', JSON.stringify(streamState));
        return Response.json({
          niconama: streamState ?? {},
          canSpeak: streamer.canSpeak,
          currentGame: streamer.currentGame ?? null,
          nGram: streamer.currentNGramSize,
          nGramRaw: streamer.currentNGramSizeRaw,
          speech: agent.getSpeech(),
          speechHistory: generatedSpeechHistory,
        });
      },
      POST: async (req) => {
        const body = await req.json();
        const published = body.data ?? body;
        console.debug('[DEBUG] POST /api/meta <-', JSON.stringify(published));
        agent.publishStreamState(published);
        return Response.json({});
      },
    },
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
  consoleServer = startConsoleServer();
  console.log(`🚀 Console running at ${consoleServer.url}`);
} catch (err) {
  const consoleStartupError = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(`[ERROR] CONSOLE_STARTUP_FAILED ${JSON.stringify(consoleStartupError)}`);
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

import { createAgentApi } from "automated-gameplay-transmitter";
import { serve } from "bun";
import { readFileSync, writeFileSync } from "node:fs";
import { setInterval } from "node:timers/promises";
import { parseArgs } from "node:util";
import { isIPAllowed } from "./lib/allowedIP";
import { FallbackTTS, MakaMujo, MarkovChainModel, TTS } from "./lib/server";
import * as index from "./routes/index";
import * as consoleRoutes from "./routes/console/index";
import App from "./src/index.html";

process.on('exit', exitHandler.bind(null, { cleanup: true }));
process.on('SIGINT', signalHandler.bind(null, { exit: true }));
process.on('SIGUSR1', signalHandler.bind(null, { exit: true }));
process.on('SIGUSR2', signalHandler.bind(null, { exit: true }));
process.on('uncaughtException', exitHandler.bind(null, { exit: true }));

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
const agent = createAgentApi(streamer);

let clearSpeechTimer: ReturnType<typeof setTimeout> | undefined = undefined;

streamer.onSpeech(async (text) => {
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
        return Response.json({ niconama: streamState ?? {} });
      },
      POST: async (req) => {
        const body = await req.json();
        agent.publishStreamState(body.data ?? body);
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

const consoleCertPath = process.env.CONSOLE_TLS_CERT ?? '/etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/fullchain.pem';
const consoleKeyPath = process.env.CONSOLE_TLS_KEY ?? '/etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/privkey.pem';

const consoleRedirectURL = 'https://live.nicovideo.jp/watch/user/14171889';

// Inner console server: binds to loopback only and serves all console routes
// (including HTML bundling). Not exposed to the public network.
let innerConsoleServer: ReturnType<typeof serve> | null = null;

// Outer console server: exposed publicly on port 443.
// Checks the client IP against the shared allowlist before proxying to the inner server.
let consoleServer: ReturnType<typeof serve> | null = null;
try {
  innerConsoleServer = serve({
    port: 0, // OS assigns a random available port
    hostname: '127.0.0.1',
    routes: consoleRoutes.routes,
    development: process.env.NODE_ENV !== "production" && {
      // Enable browser hot reloading in development
      hmr: true,

      // Echo console logs from the browser to the server
      console: true,
    },
  });

  const innerConsolePort = innerConsoleServer.port;

  consoleServer = serve({
    port: 443,
    async fetch(req, server) {
      const ip = server.requestIP(req);
      if (!isIPAllowed(ip)) {
        return Response.redirect(consoleRedirectURL, 302);
      }

      // Proxy to the inner console server, which handles HTML bundling and routing.
      const proxyURL = new URL(req.url);
      proxyURL.protocol = 'http:';
      proxyURL.hostname = '127.0.0.1';
      proxyURL.port = String(innerConsolePort);
      return fetch(proxyURL.toString(), {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
    },
    tls: {
      cert: Bun.file(consoleCertPath),
      key: Bun.file(consoleKeyPath),
    },
    development: process.env.NODE_ENV !== "production" && {
      // Enable browser hot reloading in development
      hmr: true,

      // Echo console logs from the browser to the server
      console: true,
    },
  });
  console.log(`🚀 Console running at ${consoleServer.url}`);
} catch (err) {
  throw err instanceof Error ? err : new Error(String(err));
}

let running = false;
for await (const _ of setInterval(1_000)) {
  if (!running && streamer.speechable) {
    try {
      running = true;
      await streamer.speech();
    } finally {
      running = false;
    }
  }
}

/**
 * @see {@link https://stackoverflow.com/questions/14031763/doing-a-cleanup-action-just-before-node-js-exits}
 */
function exitHandler(options: { cleanup: true; exit?: never } | { cleanup?: never; exit: true }, exitCode?: number) {
  if (options.cleanup) {
    console.log('[INFO]', 'server stopping...');
    if (server) {
      server.stop(options.exit);
    }
    if (innerConsoleServer) {
      innerConsoleServer.stop(options.exit);
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

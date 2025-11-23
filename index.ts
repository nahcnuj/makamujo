import { serve } from "bun";
import { readFileSync } from "node:fs";
import { setInterval } from "node:timers/promises";
import { parseArgs } from "node:util";
import { MakaMujo } from "./lib/Agent";
import { MarkovChainModel } from "./lib/MarkovChainModel";
import TTS from "./lib/TTS";
import * as index from "./routes/index";
import App from "./src/index.html";

process.on('exit', exitHandler.bind(null, { cleanup: true }));
process.on('SIGINT', signalHandler.bind(null, { exit: true }));
process.on('SIGUSR1', signalHandler.bind(null, { exit: true }));
process.on('SIGUSR2', signalHandler.bind(null, { exit: true }));
process.on('uncaughtException', exitHandler.bind(null, { exit: true }));

const { values: {
  model: modelFile,
  data: dataFile,
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
  },
});

const model = modelFile ? MarkovChainModel.fromFile(modelFile) : new MarkovChainModel();

const htsvoiceFile = '/usr/share/hts-voice/nitech-jp-atr503-m001/nitech_jp_atr503_m001.htsvoice';
const dictionaryDir = '/var/lib/mecab/dic/open-jtalk/naist-jdic';
const tts = new TTS({
  htsvoiceFile,
  dictionaryDir,
});

let speech: string = '';

const streamer = new MakaMujo(model, tts)
  .onSpeech(async (text) => {
    speech = text;
  });
streamer.play('CookieClicker', readFileSync(dataFile, { encoding: 'utf-8' }));

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    '/*': App,

    '/': index,

    '/api/speech': async () => {
      return Response.json({
        speech,
      });
    },

    '/api/game': async () => {
      return Response.json({
        game: 'cookieclicker',
        datetime: new Date().toISOString(),
      });
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
    server.stop(options.exit);
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

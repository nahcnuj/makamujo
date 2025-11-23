import { serve } from "bun";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { MakaMujo } from "./lib/Agent";
import { MarkovChainModel } from "./lib/MarkovChainModel";
import TTS from "./lib/TTS";
import * as index from "./routes/index";
import App from "./src/index.html";

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
    // console.debug('[DEBUG]', 'speech', text);
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

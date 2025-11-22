import { serve } from "bun";
import { parseArgs } from "node:util";
import { MakaMujo } from "./lib/Agent";
import { MarkovChainModel } from "./lib/MarkovChainModel";
import TTS from "./lib/TTS";
import * as index from "./routes/index";
import App from "./src/index.html";
import { setInterval } from "node:timers/promises";

const { values: {
  model: modelFile,
} } = parseArgs({
  options: {
    model: {
      short: 'm',
      type: 'string',
      default: './var/model.json',
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

let speech: string | undefined;

const streamer = new MakaMujo(model)
  .onSpeech(async (text) => {
    console.debug('[DEBUG]', 'speech', speech = text);

    tts.speech(text);

    speech = undefined;
  });

(async () => {
  let running = false;
  for await (const _ of setInterval(1_000)) {
    if (!running) {
      running = true;
      try {
        await streamer.speech();
      } catch (err) {
        console.error(err);
      } finally {
        running = false;
      }
    }
  }
})();

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    '/*': App,

    '/': index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },

    '/api/speech': async () => {
      return Response.json({
        text: speech ?? '',
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

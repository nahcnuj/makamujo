import { serve } from "bun";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { MakaMujo } from "./lib/Agent";
import { MarkovChainModel } from "./lib/MarkovChainModel";
import * as index from "./routes/index";
import App from "./src/index.html";

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

let speech: string | undefined;

const streamer = new MakaMujo(model);
streamer.onSpeech(async (text) => {
  console.debug('[DEBUG]', 'say', speech = text);

  // TODO tts
  await setTimeout(100 * text.length);

  speech = undefined;
});

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

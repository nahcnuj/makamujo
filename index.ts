import { serve } from "bun";
import { parseArgs } from "node:util";
import { MarkovChainModel } from "./lib/MarkovChainModel";
import App from "./src/index.html";
import * as index from "./routes/index";

const { values: {
  model: modelFile,
} } = parseArgs({
  options: {
    model: {
      short: 'm',
      type: 'string',
    },
  },
});

const model = modelFile ? MarkovChainModel.fromFile(modelFile) : new MarkovChainModel();

const text = model.generate();

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
        text,
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

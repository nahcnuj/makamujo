import { serve } from "bun";
import index from "./src/index.html";

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    // '/*': index,
    '/*': new Response('Hello\n', { headers: { 'Cache-Control': 'no-store' } }),

    '/robots.txt': new Response('User-agent: *\nDisallow: /\n'),

    "/api/hello": {
      async GET(req) {
        console.debug(req.text());
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        console.debug(req.text());
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      console.debug(req.text());
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },

  ...(process.env.NODE_ENV !== "production" ?
    {
      development: {
        // Enable browser hot reloading in development
        hmr: true,

        // Echo console logs from the browser to the server
        console: true,
      },
    } :
    {
      port: 443,
      tls: {
        cert: Bun.file("/etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/cert.pem"),
        key: Bun.file("/etc/letsencrypt/live/x85-131-251-123.static.xvps.ne.jp/privkey.pem"),
      },
    }),
});

console.log(`🚀 Server running at ${server.url}`);

import ConsoleApp from "../../console/src/index.html";

export const routes = {
  '/*': ConsoleApp,

  '/robots.txt': new Response('User-agent: *\nDisallow: /\n'),

  "/api/hello": {
    async GET(req: Request) {
      console.debug(await req.text());
      return Response.json({
        message: "Hello, world!",
        method: "GET",
      });
    },
    async PUT(req: Request) {
      console.debug(await req.text());
      return Response.json({
        message: "Hello, world!",
        method: "PUT",
      });
    },
  },

  "/api/hello/:name": async (req: Bun.BunRequest<"/api/hello/:name">) => {
    console.debug(await req.text());
    const name = req.params.name;
    return Response.json({
      message: `Hello, ${name}!`,
    });
  },
};

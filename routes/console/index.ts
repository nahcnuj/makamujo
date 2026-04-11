import ConsoleApp from "../../console/src/index.html";

export const routes = {
  '/console/*': ConsoleApp,

  '/console/robots.txt': new Response('User-agent: *\nDisallow: /\n'),

  "/console/api/hello": {
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

  "/console/api/hello/:name": async (req: Bun.BunRequest<"/console/api/hello/:name">) => {
    console.debug(await req.text());
    const name = req.params.name;
    return Response.json({
      message: `Hello, ${name}!`,
    });
  },
};

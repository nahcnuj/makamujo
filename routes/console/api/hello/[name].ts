export default async function (req: Bun.BunRequest<"/console/api/hello/:name">) {
  console.debug(await req.text());
  const name = req.params.name;
  return Response.json({
    message: `Hello, ${name}!`,
  });
}

export default async function handleHelloName(req: Bun.BunRequest<"/console/api/hello/:name">) {
  console.debug(await req.text());
  const name = req.params.name;
  return Response.json({
    message: `Hello, ${name}!`,
  });
}

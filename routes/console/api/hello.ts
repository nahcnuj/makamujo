export async function GET(req: Request) {
  console.debug(await req.text());
  return Response.json({
    message: "Hello, world!",
    method: "GET",
  });
}

export async function PUT(req: Request) {
  console.debug(await req.text());
  return Response.json({
    message: "Hello, world!",
    method: "PUT",
  });
}

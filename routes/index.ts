let allowIP = '';

export const POST: Bun.Serve.Handler<Bun.BunRequest, Bun.Server<unknown>, Response> = (req, server) => {
  const ip = server.requestIP(req);
  if (!ip) {
    console.error('[ERROR]', `No IP address is available in the request:`, JSON.stringify(req));
    return Response.json(undefined, { status: 404 });
  }
  const { address, family } = ip;
  allowIP = `${family}/${address}`;
  // console.debug('[DEBUG]', 'Connected from', client, 'at', new Date().toISOString());
  return new Response();
};

export const PUT: Bun.Serve.Handler<Bun.BunRequest, Bun.Server<unknown>, Response> = async (req, server) => {
  if (!allowIP) return Response.json(undefined, { status: 404 });

  const ip = server.requestIP(req);
  if (!ip) return Response.json(undefined, { status: 404 });

  const clientIP = `${ip.family}/${ip.address}`;
  if (clientIP !== allowIP) {
    console.error('[ERROR]', `got ${clientIP}, want ${allowIP}`);
    return Response.json(undefined, { status: 404 });
  }

  const comments: unknown[] = await req.json();
  
  console.log(JSON.stringify(comments, null, 2));

  return new Response();
}; 
import { setAllowedIP, isIPAllowed } from "../lib/allowedIP";

export const POST: Bun.Serve.Handler<Bun.BunRequest, Bun.Server<unknown>, Response> = (req, server) => {
  const ip = server.requestIP(req);
  if (!ip) {
    console.error('[ERROR]', `No IP address is available in the request:`, JSON.stringify(req));
    return Response.json(undefined, { status: 404 });
  }
  const { address, family } = ip;
  setAllowedIP(family, address);
  // console.debug('[DEBUG]', 'Connected from', client, 'at', new Date().toISOString());
  return new Response();
};

export const PUT: Bun.Serve.Handler<Bun.BunRequest, Bun.Server<unknown>, Response> = async (req, server) => {
  const ip = server.requestIP(req);
  if (!isIPAllowed(ip)) {
    if (ip) {
      console.error('[ERROR]', `rejected request from ${ip.family}/${ip.address}`);
    }
    return Response.json(undefined, { status: 404 });
  }

  const comments: any[] = await req.json();
  // console.debug('[DEBUG]', 'PUT /', JSON.stringify(comments.map(({ data }) => data), null, 2));

  return Response.json(comments);
};

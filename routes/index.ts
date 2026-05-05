import { AllowedIP } from "../lib/allowedIP";

type IPInfo = { family: string; address: string };

export const POST = (req: Request, ip: IPInfo | null): Response => {
  if (!ip) {
    try {
      console.error('[ERROR]', 'No IP address is available in the request:', { method: req.method, url: req.url });
    } catch {
      console.error('[ERROR]', 'No IP address is available in the request (failed to log request details)');
    }
    return Response.json(undefined, { status: 404 });
  }
  AllowedIP.set(ip);
  return new Response();
};

export const PUT = async (req: Request, ip: IPInfo | null): Promise<Response> => {
  if (!ip) {
    return Response.json(undefined, { status: 404 });
  }
  if (!AllowedIP.equals(ip)) {
    console.error('[ERROR]', `rejected request from ${ip.family}/${ip.address}`);
    return Response.json(undefined, { status: 404 });
  }

  const comments: any[] = await req.json();
  return Response.json(comments);
};

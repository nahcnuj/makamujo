// FIXED: single implementation of handleCatchAll
export function handleCatchAll(req: Request): Response {
  const url = new URL(req.url);
  const path = url.pathname;
  const accept = req.headers.get('accept') ?? '';
  try { console.log('[TRACE] catch-all matched path=', path, 'accept=', accept); } catch {}

  // Treat as a navigation (serve index.html) only when the request
  // is explicitly for HTML navigation. Some embedded browsers (OBS)
  // include `text/html` in Accept headers for subresource requests
  // such as module imports (e.g. `/frontend.tsx`). Avoid returning
  // `index.html` for requests that look like file/module paths by
  // checking for a path extension.
  const looksLikeFile = path.includes('.') && !path.endsWith('/');
  if ((accept.includes('text/html') && !looksLikeFile) || path === '/') {
    try {
      return new Response(Bun.file('./src/index.html'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } catch (err) {
      try { console.error('[ERROR] failed to serve index.html', err); } catch {}
      return Response.json({}, { status: 500 });
    }
  }

  const candidates = [
    `./src${path}`,
    `./src${path}.tsx`,
    `./src${path}.ts`,
    `./src${path}.jsx`,
    `./src${path}.js`,
    `./src${path}.mjs`,
    `./src${path}.css`,
    `./src${path}.html`,
    `./src/public${path}`,
    `./src/public${path}.png`,
    `./src/public${path}.svg`,
  ];

  for (const p of candidates) {
    try {
      const file = Bun.file(p);
      const ct = p.endsWith('.css') ? 'text/css; charset=utf-8'
        : p.match(/\.tsx$|\.ts$|\.jsx$|\.js$|\.mjs$/) ? 'application/javascript; charset=utf-8'
        : p.endsWith('.html') ? 'text/html; charset=utf-8'
        : p.endsWith('.png') ? 'image/png'
        : p.endsWith('.svg') ? 'image/svg+xml'
        : undefined;
      return new Response(file, ct ? { headers: { 'Content-Type': ct } } : undefined);
    } catch (err) {
      // try next
    }
  }

  try {
    return new Response(Bun.file('./src/index.html'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    try { console.error('[ERROR] failed to serve index.html', err); } catch {}
    return Response.json({}, { status: 500 });
  }
}

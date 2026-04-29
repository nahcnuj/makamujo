export function handleCatchAll(req: Request): Response {
  const url = new URL(req.url);
  const path = url.pathname;
  const accept = req.headers.get('accept') ?? '';
  try { console.log('[TRACE] catch-all matched path=', path, 'accept=', accept); } catch {}

  // If the client explicitly accepts HTML (browser navigation) or
  // this is the root path, serve the SPA entrypoint.
  if (accept.includes('text/html') || path === '/') {
    try {
      return new Response(Bun.file('./src/index.html'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } catch (err) {
      try { console.error('[ERROR] failed to serve index.html', err); } catch {}
      return Response.json({}, { status: 500 });
    }
  }

  // Try to resolve static/module files from ./src and ./src/public.
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
      // File not found or unreadable; try next candidate.
    }
  }

  // If nothing matched, fall back to serving index.html to keep SPA
  // navigation working for unknown routes.
  try {
    return new Response(Bun.file('./src/index.html'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    try { console.error('[ERROR] failed to serve index.html', err); } catch {}
    return Response.json({}, { status: 500 });
  }
}
export function handleCatchAll(req: Request): Response {
  const url = new URL(req.url);
  const path = url.pathname;
  const accept = req.headers.get('accept') ?? '';
  try { console.log('[TRACE] catch-all matched path=', path, 'accept=', accept); } catch {}

  // If the client explicitly accepts HTML (browser navigation) or
  // this is the root path, serve the SPA entrypoint.
  if (accept.includes('text/html') || path === '/') {
    try {
      return new Response(Bun.file('./src/index.html'), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } catch (err) {
      try { console.error('[ERROR] failed to serve index.html', err); } catch {}
      return Response.json({}, { status: 500 });
    }
  }

  // Try to resolve static/module files from ./src and ./src/public.
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
      // File not found or unreadable; try next candidate.
    }
  }

  // If nothing matched, fall back to serving index.html to keep SPA
  // navigation working for unknown routes.
  try {
    return new Response(Bun.file('./src/index.html'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    try { console.error('[ERROR] failed to serve index.html', err); } catch {}
    return Response.json({}, { status: 500 });
  }
}
export function handleCatchAll(req: Request): Response {
  const url = new URL(req.url);
  const path = url.pathname;
  const accept = req.headers.get('accept') ?? '';
  try { console.log('[TRACE] catch-all matched path=', path, 'accept=', accept); } catch {}

  // If the client explicitly accepts HTML (browser navigation) or
  // this is the root path, serve the SPA entrypoint.
  if (accept.includes('text/html') || path === '/') {
    export function handleCatchAll(req: Request): Response {
      const url = new URL(req.url);
      const path = url.pathname;
      const accept = req.headers.get('accept') ?? '';
      try { console.log('[TRACE] catch-all matched path=', path, 'accept=', accept); } catch {}

<<<<<<< HEAD
      // If the client explicitly accepts HTML (browser navigation) or
      // this is the root path, serve the SPA entrypoint.
      if (accept.includes('text/html') || path === '/') {
        try {
          return new Response(Bun.file('./src/index.html'), {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        } catch (err) {
          try { console.error('[ERROR] failed to serve index.html', err); } catch {}
          return Response.json({}, { status: 500 });
        }
      }

      // Try to resolve static/module files from ./src and ./src/public.
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
=======
  // Try to resolve static/module files from ./src and ./src/public.
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
      // File not found or unreadable; try next candidate.
    }
  }
>>>>>>> da70749 (chore: rely on Bun.serve/native asset handling (revert custom TSX transform))

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
          // File not found or unreadable; try next candidate.
        }
      }

      // If nothing matched, fall back to serving index.html to keep SPA
      // navigation working for unknown routes.
      try {
        return new Response(Bun.file('./src/index.html'), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      } catch (err) {
        try { console.error('[ERROR] failed to serve index.html', err); } catch {}
        return Response.json({}, { status: 500 });
      }
    }
<<<<<<< HEAD

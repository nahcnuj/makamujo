import { readFileSync } from "node:fs";

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
      // For TS/TSX/JSX files, read and serve as JavaScript. Some clients
      // (embedded browsers like OBS' browser) cannot parse raw TSX. To
      // avoid syntax errors we perform minimal, safe transformations for
      // common patterns used in our entrypoints (remove non-null `!`
      // assertions and convert simple JSX to `React.createElement`). This
      // keeps fast refresh/tests working while preventing runtime parse
      // errors in non-transpiling clients.
      if (p.match(/\.tsx$|\.ts$|\.jsx$/)) {
        const text = readFileSync(p, { encoding: 'utf-8' });
        let out = text;

        // Remove TypeScript non-null assertion after calls like
        // document.getElementById("root")!. These are invalid in
        // browsers when served as-is.
        out = out.replace(/\)\s*!/g, ')');

        // Simple JSX -> React.createElement conversions for our entry
        // points. This is intentionally conservative and only handles
        // the patterns present in `frontend.tsx` files.
        if (out.includes('<App')) {
          out = out.replace(/<App\s*\/?>/g, 'React.createElement(App, null)');
        }
        if (out.includes('<StrictMode')) {
          out = out.replace(/<StrictMode>/g, 'React.createElement(StrictMode, null, ');
          out = out.replace(/<\/StrictMode>/g, ')');
        }

        // Ensure `React` default import exists since we converted JSX.
        if (out.match(/React\.createElement/) && !out.match(/import\s+React\s+from\s+['"]react['"]/)) {
          // Insert after the last import statement.
          const lines = out.split('\n');
          let insertAt = 0;
          for (let i = 0; i < lines.length; i++) {
<<<<<<< HEAD
            const line = lines[i] ?? '';
            if (/^import\s/.test(line)) insertAt = i + 1;
=======
            if (/^import\s/.test(lines[i])) insertAt = i + 1;
>>>>>>> 03251b5 (fix: prevent TSX parse error in embedded browsers (#218))
          }
          lines.splice(insertAt, 0, "import React from 'react';");
          out = lines.join('\n');
        }

        return new Response(out, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
      }

      const file = Bun.file(p);
      const ct = p.endsWith('.css') ? 'text/css; charset=utf-8'
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

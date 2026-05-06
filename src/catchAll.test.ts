import { test, expect } from "bun:test";

import { handleCatchAll, getContentType, normalizeMainHtml } from "./frontendServer";

test("serves frontend.js as built JavaScript module", async () => {
  const req = new Request("http://localhost/frontend.js", { headers: { accept: '*/*' } });
  const res = await handleCatchAll(req);
  expect(res.status).toBe(200);
  const ct = res.headers.get('content-type') ?? '';
  expect(ct).toMatch(/application\/javascript/);
  const body = await res.text();
  expect(body.length).toBeGreaterThan(0);
  expect(body).not.toContain('<html');
});

test("serves index.html for navigation requests", async () => {
  const req = new Request("http://localhost/", { headers: { accept: 'text/html' } });
  const res = await handleCatchAll(req);
  expect(res.status).toBe(200);
  const ct = res.headers.get('content-type') ?? '';
  expect(ct).toMatch(/text\/html/);
  const body = await res.text();
  expect(body).toContain('<div id="root"></div>');
});

test('getContentType returns the correct content type for known assets', () => {
  expect(getContentType('/frontend.js')).toBe('application/javascript; charset=utf-8');
  expect(getContentType('/frontend.css')).toBe('text/css; charset=utf-8');
  expect(getContentType('/index.html')).toBe('text/html; charset=utf-8');
  expect(getContentType('/image.png')).toBeUndefined();
});

test('normalizeMainHtml rewrites the entrypoint and injects frontend.css when missing', () => {
  const input = '<html><head><script src="./frontend.tsx"></script></head><body></body></html>';
  const output = normalizeMainHtml(input);
  expect(output).toContain('src="./frontend.js"');
  expect(output).toContain('<link rel="stylesheet" href="./frontend.css" />');
});

test('normalizeMainHtml preserves an existing frontend.css link', () => {
  const input = '<html><head><script src="./frontend.tsx"></script><link rel="stylesheet" href="./frontend.css" /></head><body></body></html>';
  const output = normalizeMainHtml(input);
  expect(output).toContain('src="./frontend.js"');
  expect(output.match(/<link rel="stylesheet" href="\.\/frontend\.css" \/>/g)?.length).toBe(1);
});

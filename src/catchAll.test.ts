import { test, expect } from "bun:test";

import { handleCatchAll } from "./catchAll";

test("serves frontend.tsx as JavaScript module", async () => {
  const req = new Request("http://localhost/frontend.tsx", { headers: { accept: '*/*' } });
  const res = handleCatchAll(req);
  expect(res.status).toBe(200);
  const ct = res.headers.get('content-type') ?? '';
  expect(ct).toMatch(/application\/javascript/);
  const body = await res.text();
  expect(body).toContain('This file is the entry point for the app');
  expect(body).toContain('from "hono/jsx/dom"');
});

test("serves index.html for navigation requests", async () => {
  const req = new Request("http://localhost/", { headers: { accept: 'text/html' } });
  const res = handleCatchAll(req);
  expect(res.status).toBe(200);
  const ct = res.headers.get('content-type') ?? '';
  expect(ct).toMatch(/text\/html/);
  const body = await res.text();
  expect(body).toContain('<div id="root"></div>');
});

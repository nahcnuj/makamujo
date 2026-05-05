import { test, expect } from "bun:test";

import { handleCatchAll } from "./catchAll";

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

import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consoleBasePath, consoleRedirectURL, createAccessDeniedRedirectResponse, startConsoleServer } from "../../../console/index";

test("throws when TLS certificate file is missing", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'console-test-'));
  try {
    expect(() => startConsoleServer(join(tmpDir, 'nonexistent-cert.pem'), join(tmpDir, 'nonexistent-key.pem')))
      .toThrow('TLS certificate files not found');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("throws when TLS certificate file exists but key file is missing", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'console-test-'));
  const certFilePath = join(tmpDir, 'cert.pem');
  writeFileSync(certFilePath, 'placeholder');

  try {
    expect(() => startConsoleServer(certFilePath, join(tmpDir, 'nonexistent-key.pem')))
      .toThrow('TLS certificate files not found');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("returns 303 to watch page for denied /console/ access", () => {
  const response = createAccessDeniedRedirectResponse(new URL('https://example.com/console/?q=1'));
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe(consoleRedirectURL);
});

test("returns 308 to /console/ for denied non-console access", () => {
  const response = createAccessDeniedRedirectResponse(new URL('https://example.com/other/path'));
  expect(response.status).toBe(308);
  expect(response.headers.get('location')).toBe(consoleBasePath);
});

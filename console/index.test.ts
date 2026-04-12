import { test, expect } from "bun:test";
import { unlinkSync, writeFileSync, existsSync } from "node:fs";
import { startConsoleServer } from "./index";

test("throws when TLS certificate file is missing", () => {
  expect(() => startConsoleServer('/tmp/nonexistent-cert.pem', '/tmp/nonexistent-key.pem'))
    .toThrow('TLS certificate files not found');
});

test("throws when TLS certificate file exists but key file is missing", () => {
  const certFilePath = '/tmp/test-console-cert.pem';
  writeFileSync(certFilePath, 'placeholder');

  try {
    expect(() => startConsoleServer(certFilePath, '/tmp/nonexistent-key.pem'))
      .toThrow('TLS certificate files not found');
  } finally {
    if (existsSync(certFilePath)) {
      unlinkSync(certFilePath);
    }
  }
});

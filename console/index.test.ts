import { test, expect } from "bun:test";
import { startConsoleServer } from "./index";

test("throws when TLS certificate file is missing", () => {
  expect(() => startConsoleServer('/tmp/nonexistent-cert.pem', '/tmp/nonexistent-key.pem'))
    .toThrow('TLS certificate files not found');
});

test("throws when TLS certificate file exists but key file is missing", async () => {
  const certFile = Bun.file('/tmp/test-console-cert.pem');
  await Bun.write(certFile, 'placeholder');

  try {
    expect(() => startConsoleServer('/tmp/test-console-cert.pem', '/tmp/nonexistent-key.pem'))
      .toThrow('TLS certificate files not found');
  } finally {
    await certFile.unlink?.();
  }
});

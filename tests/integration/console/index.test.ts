import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startConsoleServer } from "../../../console/index";

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

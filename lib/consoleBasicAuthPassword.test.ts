import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadOrCreateConsoleBasicAuthPassword,
  resolveConsoleBasicAuthPasswordFilePath,
} from "./consoleBasicAuthPassword";

describe("consoleBasicAuthPassword store", () => {
  it("prefers env over file", () => {
    const dir = mkdtempSync(join(tmpdir(), "console-auth-"));
    const passwordFilePath = join(dir, "password");
    try {
      writeFileSync(passwordFilePath, "from-file\n");
      const resolved = loadOrCreateConsoleBasicAuthPassword({
        envPassword: "from-env",
        passwordFilePath,
      });
      expect(resolved).toMatchObject({
        password: "from-env",
        generated: false,
        source: "env",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reuses password file across calls when env is unset", () => {
    const dir = mkdtempSync(join(tmpdir(), "console-auth-"));
    const passwordFilePath = join(dir, "password");
    try {
      const first = loadOrCreateConsoleBasicAuthPassword({
        envPassword: undefined,
        passwordFilePath,
      });
      expect(first.generated).toBe(true);
      expect(first.source).toBe("generated");
      expect(readFileSync(passwordFilePath, "utf8").trim()).toBe(
        first.password,
      );

      const second = loadOrCreateConsoleBasicAuthPassword({
        envPassword: undefined,
        passwordFilePath,
      });
      expect(second).toMatchObject({
        password: first.password,
        generated: false,
        source: "file",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves default password file under cwd/var", () => {
    const path = resolveConsoleBasicAuthPasswordFilePath(undefined);
    expect(path.replace(/\\/g, "/")).toMatch(
      /var\/console-basic-auth-password$/,
    );
  });
});

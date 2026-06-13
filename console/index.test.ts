import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test";
import { startConsoleServer } from "./index";

describe("Console password generation", () => {
  let originalEnv: Record<string, string | undefined>;
  let consoleLogSpy: ReturnType<typeof mock>;
  let originalLog: typeof console.log;

  beforeEach(() => {
    // Save original console.log
    originalLog = console.log;

    // Save original environment variables
    originalEnv = {
      CONSOLE_BASIC_AUTH_PASSWORD: process.env.CONSOLE_BASIC_AUTH_PASSWORD,
      NODE_ENV: process.env.NODE_ENV,
      CONSOLE_LOOPBACK_ONLY: process.env.CONSOLE_LOOPBACK_ONLY,
    };

    // Mock console.log to capture password output
    consoleLogSpy = mock(() => {});
    console.log = consoleLogSpy as any;

    // Setup test environment
    process.env.CONSOLE_LOOPBACK_ONLY = '1'; // Use loopback mode to avoid TLS requirements
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    // Restore environment variables
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    // Restore console.log
    console.log = originalLog;
  });

  it("generates a random password when CONSOLE_BASIC_AUTH_PASSWORD is not set", () => {
    delete process.env.CONSOLE_BASIC_AUTH_PASSWORD;

    const server = startConsoleServer();
    server.stop(true);

    // Verify that console.log was called with the password message
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Console Basic auth password: /)
    );
  });

  it("generates a 16-character password", () => {
    delete process.env.CONSOLE_BASIC_AUTH_PASSWORD;

    const server = startConsoleServer();
    server.stop(true);

    // Extract the logged password
    const calls = consoleLogSpy.mock.calls;
    const passwordCall = calls.find(
      (call) => call[0] && typeof call[0] === 'string' && call[0].includes('Console Basic auth password: ')
    );

    expect(passwordCall).toBeDefined();
    if (passwordCall) {
      const passwordMatch = (passwordCall[0] as string).match(/Console Basic auth password: (.+)/);
      expect(passwordMatch).toBeDefined();
      if (passwordMatch && passwordMatch[1]) {
        const password = passwordMatch[1];
        expect(password.length).toBe(16);
        // Verify password contains only alphanumeric + special chars (no spaces or invalid chars)
        expect(password).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    }
  });

  it("uses provided password when CONSOLE_BASIC_AUTH_PASSWORD env var is set", () => {
    const providedPassword = 'my-custom-password';
    process.env.CONSOLE_BASIC_AUTH_PASSWORD = providedPassword;

    const server = startConsoleServer();
    server.stop(true);

    // When a password is provided, console.log should not be called with generation message
    // (or may be called later for other reasons, but not with "Console Basic auth password: ")
    const calls = consoleLogSpy.mock.calls;
    const passwordGenerationCalls = calls.filter(
      (call) => call[0] && typeof call[0] === 'string' && call[0].includes('Console Basic auth password: ')
    );

    // In loopback-only mode, it should not generate a password
    expect(passwordGenerationCalls.length).toBe(0);
  });

  it("generates different passwords on each call", () => {
    delete process.env.CONSOLE_BASIC_AUTH_PASSWORD;

    const passwords: string[] = [];

    // Generate passwords multiple times
    for (let i = 0; i < 3; i++) {
      consoleLogSpy = mock(() => {});
      console.log = consoleLogSpy as any;

      const server = startConsoleServer();
      server.stop(true);

      const calls = consoleLogSpy.mock.calls;
      const passwordCall = calls.find(
        (call) => call[0] && typeof call[0] === 'string' && call[0].includes('Console Basic auth password: ')
      );

      if (passwordCall) {
        const passwordMatch = (passwordCall[0] as string).match(/Console Basic auth password: (.+)/);
        if (passwordMatch && passwordMatch[1]) {
          passwords.push(passwordMatch[1]);
        }
      }
    }

    // All passwords should be unique
    const uniquePasswords = new Set(passwords);
    expect(uniquePasswords.size).toBe(passwords.length);
  });
});

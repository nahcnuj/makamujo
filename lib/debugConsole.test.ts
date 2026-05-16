import { expect, jest, test } from "bun:test";
import { suppressDebugConsoleInProduction } from "./debugConsole";

test("suppresses debug logs when NODE_ENV=production", () => {
  const originalConsoleLog = console.log;
  const originalConsoleDebug = console.debug;
  const recordedLog: unknown[][] = [];

  try {
    process.env.NODE_ENV = 'production';
    console.log = (...args: unknown[]) => { recordedLog.push(args); };
    console.debug = jest.fn();

    suppressDebugConsoleInProduction();

    console.log('[DEBUG] hidden');
    console.log('[INFO] shown');
    console.debug('[DEBUG] hidden-debug');

    expect(recordedLog).toEqual([['[INFO] shown']]);
    expect(console.debug).not.toBe(originalConsoleDebug);
  } finally {
    console.log = originalConsoleLog;
    console.debug = originalConsoleDebug;
    delete process.env.NODE_ENV;
  }
});

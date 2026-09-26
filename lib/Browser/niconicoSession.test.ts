import { describe, expect, test } from "bun:test";
import {
  type CookieLike,
  hasNiconicoSession,
  LOGIN_DISPLAY,
  NOVNC_UNIT,
  setLoginDisplay,
  setNoVncRunning,
  waitForNiconicoSession,
} from "./niconicoSession";

describe("setLoginDisplay", () => {
  test("targets the dedicated sign-in display, never the streaming display", () => {
    expect(LOGIN_DISPLAY).toBe(":11");

    const env: NodeJS.ProcessEnv = { DISPLAY: ":10" };
    setLoginDisplay(false, env);
    expect(env.DISPLAY).toBe(":11");
  });

  test("sets DISPLAY when it is unset so a plain shell still works", () => {
    const env: NodeJS.ProcessEnv = {};
    setLoginDisplay(false, env);
    expect(env.DISPLAY).toBe(":11");
  });

  test("leaves the environment alone in headless mode", () => {
    const env: NodeJS.ProcessEnv = {};
    setLoginDisplay(true, env);
    expect(env.DISPLAY).toBeUndefined();
  });
});

describe("hasNiconicoSession", () => {
  test("accepts a guest-only cookie jar as logged out", () => {
    expect(hasNiconicoSession([{ name: "nicosid" }])).toBe(false);
  });

  test("accepts an empty cookie jar as logged out", () => {
    expect(hasNiconicoSession([])).toBe(false);
  });

  test("detects the session cookie and its suffixed variants", () => {
    expect(hasNiconicoSession([{ name: "user_session" }])).toBe(true);
    expect(
      hasNiconicoSession([{ name: "nicosid" }, { name: "user_session" }]),
    ).toBe(true);
    expect(hasNiconicoSession([{ name: "user_session_secure" }])).toBe(true);
    expect(hasNiconicoSession([{ name: "user_session_internal" }])).toBe(true);
  });

  test("does not treat a lookalike cookie as a session", () => {
    expect(hasNiconicoSession([{ name: "user_sessionx" }])).toBe(true);
    expect(hasNiconicoSession([{ name: "nicosid_user_session" }])).toBe(false);
  });
});

describe("waitForNiconicoSession", () => {
  test("resolves true as soon as the session appears", async () => {
    let calls = 0;
    const read = async (): Promise<CookieLike[]> => {
      calls += 1;
      return calls < 3 ? [{ name: "nicosid" }] : [{ name: "user_session" }];
    };

    const result = await waitForNiconicoSession(read, {
      timeoutMs: 5_000,
      intervalMs: 1,
    });

    expect(result).toBe(true);
    expect(calls).toBe(3);
  });

  test("resolves true immediately when already logged in", async () => {
    let calls = 0;
    const read = async (): Promise<CookieLike[]> => {
      calls += 1;
      return [{ name: "user_session" }];
    };

    expect(
      await waitForNiconicoSession(read, { timeoutMs: 5_000, intervalMs: 1 }),
    ).toBe(true);
    expect(calls).toBe(1);
  });

  test("resolves false on timeout without exceeding it", async () => {
    const read = async (): Promise<CookieLike[]> => [{ name: "nicosid" }];
    const startedAt = Date.now();

    const result = await waitForNiconicoSession(read, {
      timeoutMs: 30,
      intervalMs: 5,
    });

    expect(result).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  test("keeps polling after a cookie read failure", async () => {
    let calls = 0;
    const read = async (): Promise<CookieLike[]> => {
      calls += 1;
      if (calls === 1) throw new Error("context closed");
      return [{ name: "user_session" }];
    };

    expect(
      await waitForNiconicoSession(read, {
        timeoutMs: 5_000,
        intervalMs: 1,
      }),
    ).toBe(true);
    expect(calls).toBe(2);
  });

  test("reports progress through onPoll", async () => {
    const seen: number[] = [];
    await waitForNiconicoSession(async () => [{ name: "nicosid" }], {
      timeoutMs: 25,
      intervalMs: 5,
      onPoll: (elapsedMs) => seen.push(elapsedMs),
    });

    expect(seen.length).toBeGreaterThan(0);
  });
});

describe("setNoVncRunning", () => {
  test("starts the unit with systemctl start", async () => {
    const calls: string[][] = [];
    await setNoVncRunning(true, async (args) => {
      calls.push([...args]);
      return 0;
    });

    expect(calls).toEqual([["systemctl", "start", NOVNC_UNIT]]);
  });

  test("stops the unit with systemctl stop", async () => {
    const calls: string[][] = [];
    await setNoVncRunning(false, async (args) => {
      calls.push([...args]);
      return 0;
    });

    expect(calls).toEqual([["systemctl", "stop", NOVNC_UNIT]]);
  });

  test("throws on a non-zero exit so the caller can react", async () => {
    await expect(setNoVncRunning(true, async () => 1)).rejects.toThrow(
      `systemctl start ${NOVNC_UNIT} exited with 1`,
    );
  });
});

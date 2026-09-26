import { setTimeout } from "node:timers/promises";

/**
 * Niconico session support for the persistent Chromium profile used by
 * `bin/x/reserve.ts`.
 *
 * The profile is long-lived, so its Niconico session cookie eventually expires
 * and every authenticated page redirects to the login form. Recovering needs a
 * human (password + Turnstile), so `reserve.ts` puts the sign-in page on a
 * dedicated X display and exposes only that display over noVNC while it runs.
 *
 * The sign-in display is deliberately *not* the streaming display `:10`:
 * reserving a stream has nothing to do with OBS or the game, and sharing `:10`
 * would also hand out the OBS window (stream key) and the game session.
 */

export const NICONICO_SESSION_COOKIE_PREFIX = "user_session";

/** X display owned by `makamujo-login-xvfb.service`, used only for sign-in. */
export const LOGIN_DISPLAY = ":11";

export const NOVNC_UNIT = "makamujo-novnc.service";

export const NOVNC_URL =
  "http://127.0.0.1:6080/vnc.html?path=websockify&autoconnect=true&resize=scale";

/** Minimal cookie shape, so callers may pass Playwright cookies directly. */
export interface CookieLike {
  name: string;
}

/**
 * A guest visit only sets `nicosid`; an authenticated session additionally
 * carries `user_session` (plus its `_secure` / `_internal` variants).
 */
export function hasNiconicoSession(cookies: readonly CookieLike[]): boolean {
  return cookies.some((cookie) =>
    cookie.name.startsWith(NICONICO_SESSION_COOKIE_PREFIX),
  );
}

export interface WaitForSessionOptions {
  timeoutMs: number;
  intervalMs?: number;
  onPoll?: (elapsedMs: number) => void;
}

/**
 * Poll `readCookies` until an authenticated Niconico session appears.
 * Resolves true on success and false on timeout; never rejects, so a caller can
 * report the failure itself and keep its own cleanup running.
 */
export async function waitForNiconicoSession(
  readCookies: () => Promise<readonly CookieLike[]>,
  options: WaitForSessionOptions,
): Promise<boolean> {
  const intervalMs = options.intervalMs ?? 3_000;
  const startedAt = Date.now();

  for (;;) {
    const elapsedMs = Date.now() - startedAt;
    try {
      if (hasNiconicoSession(await readCookies())) {
        return true;
      }
    } catch (err) {
      console.warn(
        "[WARN] failed to read cookies while waiting for login:",
        err instanceof Error ? err.message : String(err),
      );
    }
    if (elapsedMs >= options.timeoutMs) {
      return false;
    }
    options.onPoll?.(elapsedMs);
    await setTimeout(Math.min(intervalMs, options.timeoutMs - elapsedMs));
  }
}

export type SystemctlRunner = (args: readonly string[]) => Promise<number>;

/**
 * Start or stop the on-demand noVNC unit. Throws on a non-zero exit so the
 * caller can decide whether the missing viewer is fatal.
 */
export async function setNoVncRunning(
  running: boolean,
  run: SystemctlRunner,
): Promise<void> {
  const action = running ? "start" : "stop";
  const code = await run(["systemctl", action, NOVNC_UNIT]);
  if (code !== 0) {
    throw new Error(`systemctl ${action} ${NOVNC_UNIT} exited with ${code}`);
  }
}

/** `systemctl` runner backed by Bun.spawn; exported for reuse and testing. */
export const runSystemctl: SystemctlRunner = async (args) => {
  const proc = Bun.spawn({
    cmd: [...args],
    stdout: "ignore",
    stderr: "ignore",
  });
  return await proc.exited;
};

/**
 * Point the process at the sign-in display. Chromium needs `DISPLAY` set before
 * launch and `reserve.ts` normally runs from a shell where it is unset. No-op in
 * headless mode, where no X server is contacted at all.
 */
export function setLoginDisplay(
  headless: boolean,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (headless) return;
  env.DISPLAY = LOGIN_DISPLAY;
}

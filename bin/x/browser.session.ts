#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { ActionResult } from "automated-gameplay-transmitter";
import { ServerGames as Games } from "../../lib/Agent/games/server";
import { create } from "../../lib/Browser/chromium";
import {
  areFramesIdentical,
  type GameStallState,
  initialGameStallState,
  observeGameFrame,
  resolveGameStallCheckMs,
  resolveGameStallStaticFrames,
  shouldRestartGameSession,
} from "../../lib/Browser/gameStall";
import { createRetrySender } from "../../lib/Browser/socket";

const AW_SNAP_CHECK_MS = 5_000;
/** Reloads that did not restore the picture before restarting the session. */
const MAX_CONSECUTIVE_STALLS = 3;

async function isAwSnapPage(
  browser: Awaited<ReturnType<typeof create>>,
): Promise<boolean> {
  try {
    const title = await browser.evaluate(() => document.title || "");
    const text = await browser.evaluate(() =>
      (document.body?.innerText || "").slice(0, 300),
    );
    return (
      /aw,\s*snap/i.test(title ?? "") ||
      /aw,\s*snap/i.test(text ?? "") ||
      /something went wrong while displaying/i.test(text ?? "")
    );
  } catch {
    // evaluate failed → renderer likely dead
    return true;
  }
}

const {
  values: {
    file: _file,
    browser: browserArg,
    lang: _lang,
    timeout: timeoutStr,
    display,
    xauthority,
  },
} = parseArgs({
  options: {
    file: {
      short: "f",
      type: "string",
      default: "./var/cookieclicker.txt",
    },
    browser: {
      type: "string",
    },
    lang: {
      type: "string",
      default: "日本語",
    },
    timeout: {
      type: "string",
      default: (2 ** 31 - 1).toFixed(0),
    },
    display: {
      type: "string",
    },
    xauthority: {
      type: "string",
    },
  },
});

// Prefer: CLI --display > existing DISPLAY env (from bin/start) > :10 if present > auto-detect
const resolvedDisplay =
  display ??
  process.env.DISPLAY ??
  (() => {
    try {
      const x11UnixDir = "/tmp/.X11-unix";
      if (existsSync(`${x11UnixDir}/X10`)) {
        return ":10";
      }
      const socketName = readdirSync(x11UnixDir).find((name) =>
        /^X\d+$/.test(name),
      );
      if (socketName !== undefined) {
        return `:${socketName.slice(1)}`;
      }
    } catch {
      /* auto-detection is best-effort */
    }
    return undefined;
  })();

if (resolvedDisplay) {
  process.env.DISPLAY = resolvedDisplay;
}
if (xauthority) {
  // Only accept absolute Xauthority paths without traversal.
  if (
    xauthority.startsWith("/") &&
    !xauthority.includes("\0") &&
    !xauthority.includes("..") &&
    /^[A-Za-z0-9_./-]+$/.test(xauthority)
  ) {
    process.env.XAUTHORITY = xauthority;
  }
} else if (resolvedDisplay !== undefined) {
  const displayNum = resolvedDisplay.replace(/^:/, "").replace(/\..*$/, "");
  // Display numbers must be decimal digits only (js/path-injection).
  if (/^\d+$/.test(displayNum)) {
    const socketPath = `/tmp/.X11-unix/X${displayNum}`;
    try {
      const { uid } = statSync(socketPath);
      const passwdEntry = readFileSync("/etc/passwd", "utf8")
        .split("\n")
        .find((line) => {
          const fields = line.split(":");
          return fields.length >= 4 && parseInt(fields[2] ?? "", 10) === uid;
        });
      if (passwdEntry !== undefined) {
        const home = passwdEntry.split(":")[5];
        if (
          home?.startsWith("/") &&
          !home.includes("..") &&
          /^[A-Za-z0-9_./-]+$/.test(home)
        ) {
          const detectedXauth = `${home}/.Xauthority`;
          if (existsSync(detectedXauth)) {
            process.env.XAUTHORITY = detectedXauth;
          }
        }
      }
    } catch {
      /* auto-detection is best-effort */
    }
  }
}

const timeout = Number.parseInt(timeoutStr, 10);
const executablePath = (browserArg?.toString() ?? "").trim() || undefined;

const browser = await create(executablePath, {
  width: 1280,
  height: 720, // match stream crop; scale via page zoom
});

let closed = false;
const closeBrowser = async () => {
  if (closed) return;
  closed = true;
  await browser.close();
};

// `process.on("exit")` does not run for signals, and the session spends its
// whole life parked in the timeout below, so systemd's SIGTERM would skip the
// cleanup and leak the Chromium profile in the OS temp dir.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    console.log("[INFO] browser session received", signal);
    void closeBrowser()
      .catch((err) => {
        console.warn("[WARN] browser close failed", err);
      })
      .finally(() => process.exit(0));
  });
}

// Aw, Snap! 監視
// `isAwSnapPage` evaluates in the page; when the renderer hangs the bounded
// evaluate rejects instead of blocking forever, so a check can outlast the
// interval. The guard keeps a slow/timing-out probe from stacking up.
let checkingAwSnap = false;
const awSnapTimer = setInterval(() => {
  if (checkingAwSnap) return;
  checkingAwSnap = true;
  void (async () => {
    try {
      if (await isAwSnapPage(browser)) {
        console.warn("[WARN] Aw, Snap! detected — attempting reload");
        try {
          await browser.reload();
          console.log("[INFO] page reloaded after Aw, Snap!");
        } catch (err) {
          console.warn(
            "[WARN] reload failed, exiting session for outer restart",
            err,
          );
          clearInterval(awSnapTimer);
          void closeBrowser().finally(() => process.exit(1));
        }
      }
    } finally {
      checkingAwSnap = false;
    }
  })();
}, AW_SNAP_CHECK_MS);

// ゲームページ無反応監視
// `isAwSnapPage` only looks at the DOM, so a page whose renderer keeps
// answering `evaluate` but whose canvas stopped painting passes it while the
// stream shows a still picture (the health checker reports "映像全体 /
// ゲーム画面部分が停止し続けています" while audio keeps decoding). Sample the page
// and reload it when it stops changing while it is supposed to be animating;
// restart the whole session if reloading never helps.
const stallCheckMs = resolveGameStallCheckMs();
const stallStaticFrames = resolveGameStallStaticFrames();
let checkingStall = false;
let stallState: GameStallState = initialGameStallState();
let previousFrame: Uint8Array | undefined;
let consecutiveStalls = 0;
const stallTimer = setInterval(() => {
  if (checkingStall) return;
  checkingStall = true;
  void (async () => {
    try {
      const { sight } = Games.VigilantFiesta;
      const [frame, screen] = await Promise.all([
        browser.screenshot(),
        browser
          .evaluate(sight)
          .then((state) => state?.screen)
          .catch(() => undefined),
      ]);
      const decision = observeGameFrame(
        stallState,
        {
          identicalToPrevious: areFramesIdentical(previousFrame, frame),
          expectedToAnimate: screen !== "result",
        },
        stallStaticFrames,
      );
      stallState = decision.state;
      previousFrame = frame;
      if (!decision.stalled) {
        consecutiveStalls = 0;
        return;
      }

      consecutiveStalls += 1;
      if (shouldRestartGameSession(consecutiveStalls, MAX_CONSECUTIVE_STALLS)) {
        console.warn(
          "[WARN] game page stayed frozen after reloads; exiting session for outer restart",
        );
        clearInterval(stallTimer);
        void closeBrowser().finally(() => process.exit(1));
        return;
      }
      console.warn("[WARN] game page stopped painting; reloading");
      await browser.reload();
      previousFrame = undefined;
      stallState = initialGameStallState();
    } catch (err) {
      console.warn("[WARN] game liveness probe failed", err);
    } finally {
      checkingStall = false;
    }
  })();
}, stallCheckMs);

const send = await createRetrySender(
  async (action) => {
    try {
      switch (action.name) {
        case "noop": {
          await setTimeout(100);
          const { sight } = Games.VigilantFiesta;
          const [state, selectedText] = await Promise.all([
            browser.evaluate(sight),
            browser.evaluate(() => document.getSelection()?.toString()),
          ]).catch((err) => {
            console.warn(err);
            return [];
          });
          send({
            name: "idle",
            url: browser.url,
            selectedText,
            state,
          });
          return;
        }
        case "open": {
          await browser.open(action.url);
          send(ActionResult.ok(action));
          return;
        }
        case "click": {
          const target = action.target;
          switch (target.type) {
            case "text": {
              await browser.clickByText(target.text);
              send(ActionResult.ok(action));
              break;
            }
            case "id": {
              await browser.clickByElementId(target.id);
              send(ActionResult.ok(action));
              break;
            }
            default: {
              console.error("[ERROR]", "Unimplemented target type", target);
              send(ActionResult.error(action));
              break;
            }
          }
          return;
        }
        case "press": {
          await browser.press(action.key, action.on?.selector ?? "body");
          send(ActionResult.ok(action));
          return;
        }
        case "fill": {
          await browser.fillByRole(
            action.value,
            action.on.role,
            action.on.selector,
          );
          send(ActionResult.ok(action));
          return;
        }
      }
    } catch (err) {
      console.error(err);
      send(ActionResult.error(action));
    }
  },
  (send) => {
    send({ name: "initialized" });
  },
);

try {
  await setTimeout(timeout);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  clearInterval(awSnapTimer);
  clearInterval(stallTimer);
  await closeBrowser();
  send({ name: "closed" });
}

process.exit();

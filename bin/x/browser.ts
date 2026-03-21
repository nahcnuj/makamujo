#!/usr/bin/env bun

if (typeof Bun !== "undefined" && process.env.RUN_BROWSER_SCRIPT !== "1") {
  console.warn("[WARN] bun environment detected: re-launching under node for Playwright compatibility...");
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const script = fileURLToPath(import.meta.url);
  const child = spawn("node", [script, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, RUN_BROWSER_SCRIPT: "1" },
  });
  const result = await new Promise<number>((resolve, reject) => {
    child.on("exit", (code) => {
      if (typeof code === "number") {
        resolve(code);
      } else {
        resolve(0);
      }
    });
    child.on("error", (err) => reject(err));
  });
  process.exit(result);
}

import { ActionResult } from "automated-gameplay-transmitter";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { ServerGames as Games } from "../../lib/Agent/games/server";
import { create } from "../../lib/Browser/chromium";
import { createSender } from "../../lib/Browser/socket";
import { getDefaultBrowserPath } from "../../lib/Browser/getDefaultBrowserPath";

const { values: {
  file,
  browser: browserArg,
  lang,
  timeout: timeoutStr,
} } = parseArgs({
  options: {
    file: {
      short: 'f',
      type: 'string',
      default: './var/cookieclicker.txt',
    },
    browser: {
      type: 'string',
      default: getDefaultBrowserPath(),
    },
    lang: {
      type: 'string',
      default: '日本語',
    },
    timeout: {
      type: 'string',
      default: Number.MAX_SAFE_INTEGER.toFixed(0),
    },
  },
});

const timeout = Number.parseInt(timeoutStr, 10);
const executablePath = (browserArg?.toString() ?? "").trim() || undefined;

const browser = await create(executablePath, {
  width: 1280,
  height: 720 + 32 /* top bar */,
});

const send = await createSender(async (action) => {
  // console.log('[DEBUG]', 'runner got', action);

  try {
    switch (action.name) {
      case 'noop': {
        const { sight } = Games['CookieClicker'];
        const [state, selectedText] = await Promise.all([
          browser.evaluate(sight),
          browser.evaluate(() => document.getSelection()?.toString()),
        ]).catch((err) => {
          console.warn(err);
          return [];
        });
        send({
          name: 'idle',
          url: browser.url,
          selectedText,
          state,
        });
        return;
      }
      case 'open': {
        await browser.open(action.url);
        send(ActionResult.ok(action));
        return;
      }
      case 'click': {
        const target = action.target;
        switch (target.type) {
          case 'text': {
            await browser.clickByText(target.text);
            send(ActionResult.ok(action));
            break;
          }
          case 'id': {
            await browser.clickByElementId(target.id);
            send(ActionResult.ok(action));
            break;
          }
          default: {
            console.error('[ERROR]', 'Unimplemented target type', target);
            send(ActionResult.error(action));
            break;
          }
        }
        return;
      }
      case 'press': {
        await browser.press(action.key, action.on?.selector ?? 'body');
        send(ActionResult.ok(action));
        return;
      }
      case 'fill': {
        await browser.fillByRole(action.value, action.on.role, action.on.selector);
        send(ActionResult.ok(action));
        return;
      }
    }
  } catch (err) {
    console.error(err);
    send(ActionResult.error(action));
  }
});

send({ name: 'initialized' });

try {
  await setTimeout(timeout);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
  send({ name: 'closed' });
}

process.exit();

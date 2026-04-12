#!/usr/bin/env bun

import { ActionResult } from "automated-gameplay-transmitter";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { ServerGames as Games } from "../../lib/Agent/games/server";
import { create } from "../../lib/Browser/chromium";
import { createRetrySender } from "../../lib/Browser/socket";
import { getDefaultBrowserPath } from "../../lib/Browser/getDefaultBrowserPath";

const { values: {
  file,
  browser: browserArg,
  lang,
  timeout: timeoutStr,
  display,
  xauthority,
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
      default: (2 ** 31 - 1).toFixed(0),
    },
    display: {
      type: 'string',
    },
    xauthority: {
      type: 'string',
    },
  },
});

// When --display is not given, auto-detect the display from the first X11
// socket found in /tmp/.X11-unix/ (e.g. xrdp uses :10, not :0).
const resolvedDisplay = display ?? (() => {
  try {
    const x11UnixDir = '/tmp/.X11-unix';
    const socketName = readdirSync(x11UnixDir).find(name => /^X\d+$/.test(name));
    if (socketName !== undefined) {
      return `:${socketName.slice(1)}`;
    }
  } catch { /* auto-detection is best-effort */ }
  return undefined;
})();

if (resolvedDisplay) {
  process.env.DISPLAY = resolvedDisplay;
}
if (xauthority) {
  process.env.XAUTHORITY = xauthority;
} else if (resolvedDisplay !== undefined) {
  // When --display is given (or auto-detected) without --xauthority, try to
  // auto-detect the Xauthority file from the owner of the X11 socket so that
  // connections from a different login session (e.g. serial console as root)
  // can authenticate.
  const displayNum = resolvedDisplay.replace(/^:/, '').replace(/\..*$/, '');
  const socketPath = `/tmp/.X11-unix/X${displayNum}`;
  try {
    const { uid } = statSync(socketPath);
    const passwdEntry = readFileSync('/etc/passwd', 'utf8')
      .split('\n')
      .find(line => {
        const fields = line.split(':');
        return fields.length >= 4 && parseInt(fields[2] ?? '', 10) === uid;
      });
    if (passwdEntry !== undefined) {
      const home = passwdEntry.split(':')[5];
      const detectedXauth = `${home}/.Xauthority`;
      if (existsSync(detectedXauth)) {
        process.env.XAUTHORITY = detectedXauth;
      }
    }
  } catch { /* auto-detection is best-effort */ }
}

const timeout = Number.parseInt(timeoutStr, 10);
const executablePath = (browserArg?.toString() ?? "").trim() || undefined;

const browser = await create(executablePath, {
  width: 1280,
  height: 720 + 32 /* top bar */,
});

const send = await createRetrySender(async (action) => {
  // console.log('[DEBUG]', 'runner got', action);

  try {
    switch (action.name) {
      case 'noop': {
        await setTimeout(100);
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
}, (send) => {
  send({ name: 'initialized' });
});

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

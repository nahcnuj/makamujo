#!/usr/bin/env bun

import { ActionResult } from "automated-gameplay-transmitter";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { Games } from "../../lib/Agent/games";
import { create } from "../../lib/Browser/chromium";
import { createSender } from "../../lib/Browser/socket";

const { values: {
  file,
  browser: executablePath,
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
      default: '/usr/bin/chromium',
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

const browser = await create(executablePath, {
  width: 1280,
  height: 720 + 32 /* top bar */,
});

const send = await createSender(async (action) => {
  console.log('[DEBUG]', 'runner got', action);

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

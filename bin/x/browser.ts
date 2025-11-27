#!/usr/bin/env bun

import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { Games } from "../../lib/Agent/games";
import { Result } from "../../lib/Browser/Action";
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
        send({
          name: 'idle',
          url: browser.url,
          state: await browser.evaluate(sight),
        });
        return;
      }
      case 'open': {
        await browser.open(action.url);
        send(Result.ok(action));
        return;
      }
      case 'click': {
        const target = action.target;
        switch (target.type) {
          case 'text': {
            await browser.clickByText(target.text);
            send(Result.ok(action));
            break;
          }
          case 'id': {
            await browser.clickByElementId(target.id);
            send(Result.ok(action));
            break;
          }
          default: {
            console.error('[ERROR]', 'Unimplemented target type', target);
            send(Result.error(action));
            break;
          }
        }
        return;
      }
      case 'press': {
        await browser.press(action.key, action.on?.selector ?? 'body');
        send(Result.ok(action));
        return;
      }
      case 'fill': {
        await browser.fillByRole(action.value, action.on.role, action.on.selector);
        send(Result.ok(action));
        return;
      }
    }
  } catch (err) {
    console.error(err);
    send(Result.error(action));
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

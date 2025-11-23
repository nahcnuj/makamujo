#!/usr/bin/env bun

import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { create } from "../../lib/Browser/chromium";
import { createSender, error, ok } from "../../lib/Browser/socket";

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

const send = createSender(async (action) => {
  console.log('[DEBUG]', 'runner got', action);

  try {
    switch (action.name) {
      case 'noop': {
        send({
          name: 'idle',
          url: browser.url,
          state: {}, // TODO
        });
        return;
      }
      case 'open': {
        await browser.open(action.url);
        send(ok(action));
        return;
      }
      case 'click': {
        if (typeof action.target === 'string') {
          await browser.clickByText(action.target);
          send(ok(action));
        } else {
          console.error('[ERROR]', 'Unimplemented target', action.target);
        }
        return;
      }
      case 'press': {
        await browser.press(action.key, action.on?.selector ?? 'body');
        send(ok(action));
        return;
      }
      case 'fill': {
        await browser.fillByRole(action.value, action.on.role as any, action.on.selector);
        send(ok(action));
        return;
      }
    }
  } catch (err) {
    console.error(err);
    send(error(action));
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

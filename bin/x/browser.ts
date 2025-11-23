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

  switch (action.name) {
    case 'noop': {
      return;
    }
    case 'open': {
      try {
        await browser.open(action.url);
        send(ok(action));
      } catch (err) {
        console.error(err);
        send(error(action));
      }
      return;
    }
    case 'click': {
      if (typeof action.target === 'string') {
        try {
          await browser.clickByText(action.target);
          send(ok(action));
        } catch (err) {
          console.error(err);
          send(error(action));
        }
      } else {
        console.error('[ERROR]', 'Unimplemented target', action.target);
      }
      return;
    }
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

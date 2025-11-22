#!/usr/bin/env bun

import { setInterval, setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
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

const send = createSender(async (action) => {
  console.log('[DEBUG]', 'sender got', action);
  switch (action.name) {
    case 'noop': {
      return;
    }
    case 'open': {
      await browser.open(action.url);
      send({
        name: 'idle',
        url: browser.url,
      });
      return;
    }
  }
});

send({ name: 'initialized' });

try {
  let running = false;
  for await (const start of setInterval(1_000, Date.now())) {
    if (!running) {
      if (Date.now() - start >= timeout) {
        break;
      }
      running = true;

      send({
        name: 'idle',
        url: browser.url,
      });

      running = false;
    }
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}

send({ name: 'closed' });
process.exit();

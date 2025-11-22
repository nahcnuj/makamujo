#!/usr/bin/env bun

import { setInterval, setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { create } from "../../lib/Browser/chromium";
import { createSender } from "../../lib/Browser/socket";

const { values: {
  file,
  browser: executablePath,
  lang,
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
  },
});

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
  for await (const _ of setInterval(1_000)) {
    if (!running) {
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
} finally {
  await browser.close();
}

send({ name: 'closed' });

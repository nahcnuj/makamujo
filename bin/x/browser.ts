#!/usr/bin/env bun

import { setTimeout } from "node:timers/promises";
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
    default: {
      console.error('[ERROR]', 'unknown action', action);
      return;
    }
  }
});

send({
  name: 'waiting',
});

try {
  await browser.open('https://example.com/');
  await setTimeout(60_000);
} catch (err) {
  console.error(err);
} finally {
  await browser.close();
}

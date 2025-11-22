#!/usr/bin/env bun

import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { create } from "../../lib/Browser/chromium";

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

try {
  await browser.open('https://example.com/');
  await setTimeout(60_000);
} catch (err) {
  console.error(err);
} finally {
  await browser.close();
}

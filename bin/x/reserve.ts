#!/usr/bin/env bun

import { statSync } from "node:fs";
import { parseArgs } from "node:util";
import { launchPersistentContext } from "../../lib/Browser/chromium";
import {
  hasNiconicoSession,
  NOVNC_URL,
  runSystemctl,
  setLoginDisplay,
  setNoVncRunning,
  waitForNiconicoSession,
} from "../../lib/Browser/niconicoSession";

const {
  values: {
    "user-data-dir": userDataDir,
    "exec-path": executablePath,
    headless,
  },
} = parseArgs({
  options: {
    "user-data-dir": {
      type: "string",
      default: "./playwright/.auth/",
    },
    "exec-path": {
      type: "string",
    },
    headless: {
      short: "y",
      type: "boolean",
      default: false,
    },
  },
});

if (!statSync(userDataDir).isDirectory()) {
  throw new Error("--user-data-dir must be a directory path");
}

// noVNC has no authentication, so it is exposed only for this run and only for
// the sign-in display; the streaming display :10 stays untouched.
let noVncStarted = false;
const startNoVnc = async (): Promise<void> => {
  try {
    await setNoVncRunning(true, runSystemctl);
    noVncStarted = true;
    console.debug(`noVNC started. Open ${NOVNC_URL} through an SSH tunnel.`);
  } catch (err) {
    console.warn(
      "[WARN] failed to start noVNC; interactive sign-in is unavailable:",
      err instanceof Error ? err.message : String(err),
    );
  }
};
const stopNoVnc = async (): Promise<void> => {
  if (!noVncStarted) return;
  try {
    await setNoVncRunning(false, runSystemctl);
    noVncStarted = false;
    console.debug("noVNC stopped.");
  } catch (err) {
    console.warn(
      "[WARN] failed to stop noVNC; stop it manually:",
      err instanceof Error ? err.message : String(err),
    );
  }
};

// `exit` alone does not fire on SIGINT/SIGTERM, so an interrupted run would
// otherwise leave the unauthenticated sign-in display reachable.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    void stopNoVnc().finally(() => process.exit(0));
  });
}

process.on("exit", () => {
  if (noVncStarted) {
    Bun.spawn({ cmd: ["systemctl", "stop", "makamujo-novnc.service"] });
  }
});

// The sign-in display has to exist before Chromium connects to it, and starting
// makamujo-novnc is what pulls makamujo-login-xvfb up via Requires=.
setLoginDisplay(headless);
await startNoVnc();

const launchOptions = {
  ...(executablePath ? { executablePath } : {}),
};

let ctx = await launchPersistentContext(userDataDir, {
  headless,
  ...launchOptions,
});

let page = ctx.pages()[0] ?? (await ctx.newPage());

const readCookies = () => ctx.cookies("https://www.nicovideo.jp");

// An authenticated page redirects here to the Niconico sign-in form, so
// visiting it is what puts a login form on the sign-in display for a human.
const LIVE_HISTORY_URL =
  "https://garage.nicovideo.jp/niconico-garage/live/history";

const firstDate = new Date("2025-08-03T10:48:00+09:00");
const day = new Date().getDay();

let cont = true;

try {
  if (!hasNiconicoSession(await readCookies())) {
    if (headless) {
      // A headless browser shows nobody a sign-in form, so sign in visibly.
      console.debug("Signed out; relaunching headful on the sign-in display.");
      await ctx.close();
      setLoginDisplay(false);
      ctx = await launchPersistentContext(userDataDir, {
        headless: false,
        ...launchOptions,
      });
      page = ctx.pages()[0] ?? (await ctx.newPage());
    }

    await page.goto(LIVE_HISTORY_URL);
    console.debug(
      `Not signed in to Niconico. Sign in on ${NOVNC_URL} (display :11), up to 15 minutes...`,
    );
    const signedIn = await waitForNiconicoSession(readCookies, {
      timeoutMs: 15 * 60_000,
      intervalMs: 3_000,
      onPoll: (elapsedMs) =>
        console.debug(
          `Waiting for the Niconico sign-in... ${Math.round(elapsedMs / 1000)}s`,
        ),
    });
    if (!signedIn) {
      throw new Error("timed out waiting for the Niconico sign-in");
    }
    console.debug("Signed in.");
  }

  do {
    console.debug(`Getting the date of the latest live...`);
    const next = await (async () => {
      await page.goto(LIVE_HISTORY_URL);
      const frame = page.frameLocator("iframe[src]");
      const child = frame.getByText("終了").first();
      await child.waitFor({ state: "attached" });
      const datetime = await child.getAttribute("datetime");
      if (!datetime) {
        throw new Error("datetime is null");
      }
      return new Date(datetime);
    })();
    console.debug(next.toLocaleString("ja-JP"));

    await page.goto("https://live.nicovideo.jp/create", {
      waitUntil: "domcontentloaded",
    });
    console.debug(`Creating a reservation...`);

    try {
      const btn = page.getByRole("button", { name: "閉じる" });
      await btn.waitFor({ state: "visible", timeout: 1_000 });
      await btn.click({ timeout: 100 });
    } catch {
      // do nothing
    }

    {
      const detailButton = page.getByRole("button", { name: "詳細設定を開く" });
      await detailButton.click();
      await detailButton.waitFor({ state: "hidden" });
      console.debug(`Opened the detail configuration.`);
    }

    {
      const titleInput = page.getByLabel("番組タイトル", { exact: true });
      const _day = Math.ceil(
        (next.getTime() - firstDate.getTime()) / 1000 / 60 / 60 / 24,
      );
      const title = "滅茶苦茶な落ち物パズル実況"; //`滅茶苦茶なクッキークリッカー実況 ${day}日目`;
      await titleInput.fill(title);
      console.debug(`Filled title: "${title}"`);
    }
    await page.getByRole("button", { name: "予約放送を利用する" }).click();
    console.debug(`Reservating...`);

    {
      console.debug(`Selecting date...`);
      const selects = page
        .getByText("放送開始日時")
        .locator("xpath=../..")
        .locator("select");

      {
        const date = new Intl.DateTimeFormat("ja-JP", {
          year: "numeric",
          month: "numeric",
          day: "numeric",
        }).format(next);
        console.debug(`Next date: ${date}`);

        const reserveDate = selects.nth(0);
        await reserveDate.click();
        const selected = await reserveDate.selectOption({ value: date });
        console.debug(`Selected date: ${selected}`);
      }

      {
        const reserveHours = selects.nth(1);
        await reserveHours.click();
        const selected = await reserveHours.selectOption({
          label: next.getHours().toString(),
        });
        console.debug(`Selected hours: ${selected}`);
      }

      {
        const reserveMinutes = selects.nth(2);
        await reserveMinutes.click();
        const selected = await reserveMinutes.selectOption({
          value: next.getMinutes().toString(),
        });
        console.debug(`Selected minutes: ${selected}`);
      }
    }

    {
      console.debug(`Selecting duration...`);

      const selects = page
        .getByText("放送時間")
        .locator("xpath=../..")
        .locator("select");

      const [durationHours, durationMinutes] = await selects.all();
      if (!durationHours || !durationMinutes) {
        throw new Error("failed to select duration");
      }

      {
        const hours = await durationHours
          .locator(":not([disabled])")
          .last()
          .textContent();
        if (!hours) {
          throw new Error("failed to select duration hours");
        }

        await durationHours.click();
        const selected = await durationHours.selectOption({ label: hours });
        console.debug(`Selected duration hours: ${selected}`);
      }

      {
        await durationMinutes.click();
        const selected = await durationMinutes.selectOption({ value: "0" });
        console.debug(`Selected duration minutes: ${selected}`);
      }
    }

    {
      const selected = await page
        .getByLabel("強度", { exact: true })
        .selectOption({ label: "強" });
      console.debug(`Selected comment filtering strength: ${selected}`);
    }

    {
      const submit = page.getByRole("button", { name: "予約する" });
      if (headless) {
        await submit.click();
      } else {
        await submit.focus();
        console.debug(`Waiting for submitting by human...`);
      }
      await submit.waitFor({ state: "detached", timeout: 600_000 });
      console.debug(`Reserved!`);
    }

    // until the same day of the next week
    cont = next.getDay() !== day;
  } while (cont);
} finally {
  await stopNoVnc();
  await ctx.close();
}

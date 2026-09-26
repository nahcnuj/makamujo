import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  allocateFreePort,
  killProcessTree,
  makamujoIpcPath,
  resolveBunExecutable,
  type SpawnedServer,
  waitForPortRelease,
} from "../helpers/integrationServer";

/**
 * 番組配信ページの**描画された統計行**から番組情報を公開する経路の統合テスト。
 *
 * 配信ページの代わりにローカル HTTP サーバを立て、統計行の表示を再現したページを返す。
 * ページは実際のニコニコ配信ページと同じく、JS が定期取得して値を描き換える
 * （acity `: '-'` の初期表示から数字に変わる様子も再現する）。実サーバの
 * `/api/meta` まで届くことを確認する。
 *
 * Chromium が起動できない環境ではブラウザ依存の検証ができないため skip する。
 */

const SERVER_STARTUP_TIMEOUT_MS = 20_000;
const READ_INTERVAL_MS = 200;

const embeddedDataJson = JSON.stringify({
  program: {
    nicoliveProgramId: "lv351439452",
    title: "ページから読んだ配信",
    watchPageUrl: "https://live.nicovideo.jp/watch/lv351439452",
    beginTime: 1_700_000_000,
    status: "ON_AIR",
  },
});

const metricClassNames = [
  "watch-count-item",
  "comment-count-item",
  "nicoad-count-item",
  "gift-count-item",
  "timeshift-reservation-count-item",
] as const;
type MetricKey = (typeof metricClassNames)[number];

let statistics: Record<MetricKey, string> = {
  "watch-count-item": "111",
  "comment-count-item": "222",
  "nicoad-count-item": "333",
  "gift-count-item": "444",
  "timeshift-reservation-count-item": "-",
};
let programVisible = true;

const countItem = (className: MetricKey, title: string, value: string) => `
  <li class="___${className}___x ga-ns-${className} ___item___y" title="${title}">
    <button class="___count___z count" data-blank="${
      value === "-" ? "true" : "false"
    }" type="button">
      <span class="___symbol-mark___s symbol-mark"></span>
      <span class="___inner-content___i inner-content">${value}</span>
    </button>
  </li>`;

/** 実際のページと同じ「JS が取得して描画し直す」挙動を再現する。 */
const watchPageHtml = (): string => `<!DOCTYPE html><html><body>
<script id="embedded-data" data-props="${embeddedDataJson
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")}"></script>
<ul class="___program-statistics-list___q">
  ${countItem("watch-count-item", "視聴者数", statistics["watch-count-item"])}
  ${countItem("comment-count-item", "コメント数", statistics["comment-count-item"])}
  ${countItem("nicoad-count-item", "ニコニコ広告ポイント", statistics["nicoad-count-item"])}
  ${countItem("gift-count-item", "ギフトポイント", statistics["gift-count-item"])}
  ${countItem("timeshift-reservation-count-item", "タイムシフト予約数", statistics["timeshift-reservation-count-item"])}
</ul>
<script>
  const classNames = ${JSON.stringify(metricClassNames)};
  const apply = (values) => {
    for (const className of classNames) {
      const item = document.querySelector('[class*="' + className + '"]');
      if (!item) continue;
      const inner = item.querySelector("[class*='inner-content']");
      const button = item.querySelector("button");
      if (inner) inner.textContent = values[className];
      if (button) button.setAttribute("data-blank", values[className] === "-" ? "true" : "false");
    }
  };
  const refresh = async () => {
    const response = await fetch("/stats");
    const values = await response.json();
    if (values.embeddedData) {
      const script = document.querySelector("script#embedded-data");
      if (script) script.setAttribute("data-props", values.embeddedData);
    }
    apply(values);
  };
  setInterval(refresh, 100);
  refresh();
</script>
</body></html>`;

const encodedEmbeddedData = embeddedDataJson
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;");

const statsPayload = () => ({
  ...statistics,
  embeddedData: programVisible ? encodedEmbeddedData : null,
});

let watchPageServer: ReturnType<typeof createServer> | undefined;
let watchPageBaseUrl = "";
let server: SpawnedServer | null = null;
let broadcastingBaseUrl = "";
let mainServerPort = 0;

const fetchMeta = async (): Promise<any> =>
  (await fetch(`${broadcastingBaseUrl}/api/meta`)).json();

const waitForMeta = async (
  predicate: (meta: any) => boolean,
  timeoutMs = 45_000,
): Promise<any> => {
  const deadline = Date.now() + timeoutMs;
  let latest: any = undefined;
  while (Date.now() < deadline) {
    latest = await fetchMeta();
    if (predicate(latest)) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `timed out waiting for /api/meta; last payload: ${JSON.stringify(latest)}`,
  );
};

/** Chromium がこの環境で起動できるか（skip 判定）。 */
const chromiumAvailable = await (async (): Promise<boolean> => {
  try {
    const { chromium } = await import("playwright-extra");
    const browser = await chromium.launch({
      headless: true,
      timeout: 60_000,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    await browser.close();
    return true;
  } catch (error) {
    console.warn(
      "[TEST DIAG] chromium unavailable; watch page integration tests will be skipped:",
      error instanceof Error ? error.message.split("\n")[0] : String(error),
    );
    return false;
  }
})();

beforeAll(async () => {
  if (!existsSync("./var/cookieclicker.txt")) {
    try {
      mkdirSync("./var", { recursive: true });
    } catch {
      /* ignore */
    }
    writeFileSync("./var/cookieclicker.txt", "");
  }
  try {
    rmSync("./var/stream-baseline.json", { force: true });
  } catch {
    /* ignore */
  }

  watchPageServer = createServer((req, res) => {
    if (req.url?.startsWith("/stats")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(statsPayload()));
      return;
    }
    if (!programVisible) {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<html><body>404</body></html>");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(watchPageHtml());
  });
  await new Promise<void>((resolve) => {
    watchPageServer?.listen(0, "127.0.0.1", resolve);
  });
  const address = watchPageServer.address() as AddressInfo;
  watchPageBaseUrl = `http://127.0.0.1:${address.port}/watch/user/1`;

  mainServerPort = await allocateFreePort();
  broadcastingBaseUrl = `http://127.0.0.1:${mainServerPort}`;

  server = spawn(
    resolveBunExecutable(),
    ["index.ts", "--port", String(mainServerPort)],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        CONSOLE_LOOPBACK_ONLY: "1",
        NICONAMA_WATCH_PAGE_URL: watchPageBaseUrl,
        NICONAMA_WATCH_PAGE_READ_INTERVAL_MS: String(READ_INTERVAL_MS),
        MAKAMUJO_IPC_PATH: makamujoIpcPath(`watch-page-${mainServerPort}`),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ) as unknown as SpawnedServer;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanupListeners();
      reject(
        new Error(`Server startup timed out. Output:\n${buffer.slice(-2000)}`),
      );
    }, SERVER_STARTUP_TIMEOUT_MS);

    let buffer = "";
    let serverRunning = false;

    function checkReady() {
      if (serverRunning) {
        clearTimeout(timeout);
        cleanupListeners();
        resolve();
      }
    }

    function onData(chunk: Buffer | string) {
      buffer = String(chunk) + buffer;
      if (
        !serverRunning &&
        (buffer.includes("Server running") ||
          buffer.includes("🚀 Server running"))
      ) {
        serverRunning = true;
      }
      checkReady();
    }

    function onExit(code: number | null) {
      clearTimeout(timeout);
      cleanupListeners();
      reject(
        new Error(
          `Server exited early with code ${code}. Output:\n${buffer.slice(-2000)}`,
        ),
      );
    }

    function cleanupListeners() {
      try {
        server?.stdout?.off("data", onData);
      } catch {
        /* ignore */
      }
      try {
        server?.stderr?.off("data", onData);
      } catch {
        /* ignore */
      }
      try {
        server?.off("exit", onExit);
      } catch {
        /* ignore */
      }
    }

    try {
      server?.stdout?.on("data", onData);
      server?.stderr?.on("data", onData);
      server?.on("exit", onExit);
    } catch (error) {
      cleanupListeners();
      reject(error);
    }
  });
});

afterAll(async () => {
  killProcessTree(server);
  server = null;
  await waitForPortRelease();
  watchPageServer?.close();
  watchPageServer = undefined;
});

test.skipIf(!chromiumAvailable)(
  "publishes the numbers rendered on the watch page statistics row",
  async () => {
    const meta = await waitForMeta(
      (m) => m?.niconama?.meta?.total?.listeners === 111,
    );

    expect(meta.niconama.type).toBe("live");
    expect(meta.niconama.meta.title).toBe("ページから読んだ配信");
    expect(meta.niconama.meta.url).toBe(
      "https://live.nicovideo.jp/watch/lv351439452",
    );
    expect(meta.niconama.meta.total).toEqual({
      listeners: 111,
      comments: 222,
      gift: 444,
      ad: 333,
    });
    expect(meta.commentCount).toBe(222);
  },
);

test.skipIf(!chromiumAvailable)(
  "wancole POST /api/meta no longer overrides the watch page numbers",
  async () => {
    await fetch(`${broadcastingBaseUrl}/api/meta`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "niconama",
        data: {
          isLive: true,
          title: "わんコメ側の配信",
          startTime: 1,
          total: 999,
          points: { gift: 9, ad: 9 },
          url: "https://onecomme.example/lv999",
        },
      }),
    });

    const meta = await waitForMeta(
      (m) => m?.niconama?.meta?.total?.listeners === 111,
    );

    expect(meta.niconama.meta.title).toBe("ページから読んだ配信");
    expect(meta.niconama.meta.total).toEqual({
      listeners: 111,
      comments: 222,
      gift: 444,
      ad: 333,
    });
  },
);

test.skipIf(!chromiumAvailable)(
  "keeps replyTargetComment from POST /api/meta",
  async () => {
    await fetch(`${broadcastingBaseUrl}/api/meta`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        replyTargetComment: { text: "返信対象のコメント", pickedTopic: "返信" },
      }),
    });

    const meta = await waitForMeta(
      (m) => m?.replyTargetComment?.text === "返信対象のコメント",
    );

    expect(meta.niconama.meta.total.listeners).toBe(111);
  },
);

test.skipIf(!chromiumAvailable)(
  "omits metrics the page shows as a placeholder",
  async () => {
    statistics = {
      ...statistics,
      "nicoad-count-item": "-",
      "gift-count-item": "-",
    };

    const meta = await waitForMeta(
      (m) =>
        m?.niconama?.meta?.total?.listeners === 111 &&
        !("ad" in (m?.niconama?.meta?.total ?? {})),
    );

    expect("ad" in meta.niconama.meta.total).toBe(false);
    expect("gift" in meta.niconama.meta.total).toBe(false);
    expect(meta.niconama.meta.total.listeners).toBe(111);
  },
);

test.skipIf(!chromiumAvailable)(
  "reports the program as offline when the watch page has no program",
  async () => {
    programVisible = false;

    const meta = await waitForMeta((m) => m?.niconama?.type === "offline");

    expect(meta.niconama.meta.total).toEqual({});
  },
);

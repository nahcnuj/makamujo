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
 * 番組配信ページから番組情報を読む経路の統合テスト。
 * 配信ページの代わりにローカル HTTP サーバを立て、ページが埋め込む
 * `embedded-data` 相当を返して `/api/meta` まで届くことを確認する。
 */

const SERVER_STARTUP_TIMEOUT_MS = 20_000;

type ProgramStub = {
  status: string;
  watchCount: number;
  commentCount: number;
  title: string;
  beginTime: number;
};

let watchPageServer: ReturnType<typeof createServer> | undefined;
let watchPageBaseUrl = "";
let programStub: ProgramStub = {
  status: "ON_AIR",
  watchCount: 111,
  commentCount: 222,
  title: "ページから読んだ配信",
  beginTime: 1_700_000_000,
};
let programVisible = true;

const watchPageHtml = (): string => {
  if (!programVisible) {
    return "<html><body>404</body></html>";
  }
  const json = JSON.stringify({
    program: {
      nicoliveProgramId: "lv351439452",
      title: programStub.title,
      watchPageUrl: "https://live.nicovideo.jp/watch/lv351439452",
      beginTime: programStub.beginTime,
      status: programStub.status,
      statistics: {
        watchCount: programStub.watchCount,
        commentCount: programStub.commentCount,
      },
    },
  });
  return `<html><body><script id="embedded-data" data-props="${json
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")}"></script></body></html>`;
};

let server: SpawnedServer | null = null;
let broadcastingBaseUrl = "";
let mainServerPort = 0;

const fetchMeta = async (): Promise<any> =>
  (await fetch(`${broadcastingBaseUrl}/api/meta`)).json();

/** ページ更新の反映はポーリング周期（テストでは最短）任せなので条件成立まで待つ。 */
const waitForMeta = async (
  predicate: (meta: any) => boolean,
  timeoutMs = 15_000,
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

  watchPageServer = createServer((_req, res) => {
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
        NICONAMA_WATCH_PAGE_POLL_INTERVAL_MS: "200",
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

test("publishes viewer / comment counts read from the watch page", async () => {
  const meta = await waitForMeta(
    (m) => m?.niconama?.meta?.total?.listeners === 111,
  );

  expect(meta.niconama.type).toBe("live");
  expect(meta.niconama.meta.title).toBe("ページから読んだ配信");
  expect(meta.niconama.meta.url).toBe(
    "https://live.nicovideo.jp/watch/lv351439452",
  );
  expect(meta.niconama.meta.total.listeners).toBe(111);
  expect(meta.niconama.meta.total.comments).toBe(222);
  expect(meta.commentCount).toBe(222);
});

test("wancole POST /api/meta no longer overrides the watch page counts", async () => {
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
  expect(meta.niconama.meta.total.listeners).toBe(111);
  expect(meta.niconama.meta.url).toBe(
    "https://live.nicovideo.jp/watch/lv351439452",
  );
});

test("keeps replyTargetComment from POST /api/meta while the page owns the counts", async () => {
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
});

test("counts ニコニコ広告 / ギフト seen as system comments and publishes them", async () => {
  await fetch(`${broadcastingBaseUrl}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  await fetch(`${broadcastingBaseUrl}/`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      {
        data: {
          comment: "【ニコニコ広告】テスト主さんが広告しました",
          no: 1,
          anonymity: false,
          hasGift: false,
          userId: "onecomme.system",
        },
      },
      {
        data: {
          comment: "ordinary gift",
          no: 2,
          anonymity: false,
          hasGift: true,
          origin: { message: { gift: { advertiserName: "ギフト主" } } },
        },
      },
    ]),
  });

  const meta = await waitForMeta((m) => m?.niconama?.meta?.total?.ad === 1);

  expect(meta.niconama.meta.total.gift).toBe(1);
});

test("reports the program as offline when the watch page has no program", async () => {
  programVisible = false;

  const meta = await waitForMeta((m) => m?.niconama?.type === "offline");

  expect(meta.niconama.meta.total.listeners).toBe(0);
  expect(meta.niconama.meta.total.comments).toBe(0);
});

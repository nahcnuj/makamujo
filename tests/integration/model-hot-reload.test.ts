/**
 * End-to-end coverage for #639: an external rewrite of the model file must
 * rebuild the agent, while the model's own periodic persistence (after every
 * `PUT /`) must not.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  allocateFreePort,
  killProcessTree,
  makamujoIpcPath,
  resolveBunExecutable,
  type SpawnedServer,
  waitForPortRelease,
} from "../helpers/integrationServer";

const SERVER_STARTUP_TIMEOUT_MS = 20_000;
/** The watcher samples once a second and needs two samples to confirm. */
const WATCH_SETTLE_MS = 4_000;

let server: SpawnedServer | null = null;
let baseUrl = "";
let stdoutBuffer = "";
let stderrBuffer = "";
const modelPath = resolve(process.cwd(), "var", "model.json");
const baselinePath = resolve(process.cwd(), "var", "stream-baseline.json");

/**
 * Create an empty file only when it is absent.
 *
 * `flag: "wx"` is the race-free way to express "create if missing": it fails
 * instead of truncating, so an existing file is left untouched and there is no
 * check-then-write window for CodeQL to flag.
 */
const createEmptyFileIfMissing = (path: string): void => {
  try {
    writeFileSync(path, "", { flag: "wx" });
  } catch (err) {
    const code = err instanceof Error && "code" in err ? err.code : undefined;
    if (code !== "EEXIST") throw err;
  }
};

const ensureVarFiles = (): void => {
  // `recursive: true` is idempotent, so no existence check is needed here either.
  mkdirSync("./var", { recursive: true });
  createEmptyFileIfMissing("./var/cookieclicker.txt");
};

/**
 * Fixed timestamp used to make a rewrite observable on filesystems with coarse
 * mtime resolution. Pinning it means no prior stat is needed, so there is no
 * check-then-write race (and CodeQL does not flag the test).
 */
const PINNED_MTIME = new Date("2030-01-01T00:00:00Z");

/** Rewrite the model so both size and mtime differ from what is on disk. */
const rewriteModel = (body: string): void => {
  writeFileSync(modelPath, body, "utf8");
  utimesSync(modelPath, PINNED_MTIME, PINNED_MTIME);
};

const waitFor = async (
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await Bun.sleep(100);
  }
  return predicate();
};

beforeAll(async () => {
  ensureVarFiles();
  rmSync(baselinePath, { force: true });

  const port = await allocateFreePort();
  baseUrl = `http://127.0.0.1:${port}`;

  server = spawn(resolveBunExecutable(), ["index.ts", "--port", String(port)], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      CONSOLE_LOOPBACK_ONLY: "1",
      MAKAMUJO_IPC_PATH: makamujoIpcPath(`model-hot-reload-${port}`),
    },
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as SpawnedServer;

  const onStdout = (chunk: Buffer) => {
    stdoutBuffer += String(chunk);
  };
  const onStderr = (chunk: Buffer) => {
    stderrBuffer += String(chunk);
  };
  server.stdout.on("data", onStdout);
  server.stderr.on("data", onStderr);

  const started = await waitFor(
    () => stdoutBuffer.includes("Server running at"),
    SERVER_STARTUP_TIMEOUT_MS,
  );
  if (!started) {
    const output = `${stdoutBuffer}\n${stderrBuffer}`.slice(-2000);
    throw new Error(`server did not start in time. Output:\n${output}`);
  }
});

afterAll(async () => {
  killProcessTree(server);
  await waitForPortRelease();
});

const rebuildLogCount = (): number =>
  (stdoutBuffer.match(/agent rebuilt with the reloaded model/g) ?? []).length;

test("the agent is rebuilt when the model file is rewritten externally", async () => {
  expect(rebuildLogCount()).toBe(0);

  const markovModel = JSON.stringify({
    model: { "": { こんにちは: 3 } },
    corpus: ["こんにちは。"],
  });
  rewriteModel(markovModel);

  const rebuilt = await waitFor(
    () => rebuildLogCount() > 0,
    WATCH_SETTLE_MS + SERVER_STARTUP_TIMEOUT_MS,
  );
  expect(rebuilt).toBeTrue();
  expect(stdoutBuffer).toContain("model file changed outside this process");
}, 30_000);

test("the agent keeps serving after the rebuild", async () => {
  // The rebuilt streamer must still feed the publication payload, i.e. the
  // reload re-wired rather than dropped the streamer.
  const res = await fetch(`${baseUrl}/api/meta`);
  expect(res.ok).toBe(true);
  const payload = (await res.json()) as Record<string, unknown>;
  expect(payload).toHaveProperty("niconama");
  expect(payload).toHaveProperty("speech");
  expect(payload).toHaveProperty("speechHistory");

  const speech = await fetch(`${baseUrl}/api/speech`);
  expect(speech.ok).toBe(true);
  expect(await speech.json()).toHaveProperty("silent");
}, 15_000);

test("the server's own model persistence does not rebuild the agent", async () => {
  const before = rebuildLogCount();

  // `PUT /` persists the model after ingesting comments; that write must be
  // recognised as the server's own.
  await fetch(`${baseUrl}/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([
      { data: { comment: "テスト", anonymity: true, no: 1 } },
    ]),
  });

  // Long enough for several watcher samples.
  await Bun.sleep(WATCH_SETTLE_MS);

  expect(rebuildLogCount()).toBe(before);
  expect(stdoutBuffer).not.toContain("failed to reload the model file");
}, 30_000);

test("a hand edit after the rebuild triggers exactly one more rebuild", async () => {
  const before = rebuildLogCount();
  const markovModel = JSON.stringify({
    model: { "": { おやすみ: 5 } },
    corpus: ["おやすみ。"],
  });
  rewriteModel(markovModel);

  const rebuilt = await waitFor(
    () => rebuildLogCount() > before,
    WATCH_SETTLE_MS + 5_000,
  );
  expect(rebuilt).toBeTrue();

  await Bun.sleep(WATCH_SETTLE_MS);
  expect(rebuildLogCount()).toBe(before + 1);
}, 30_000);

test("the model file is still a valid Markov model afterwards", () => {
  const onDisk = JSON.parse(require("fs").readFileSync(modelPath, "utf8")) as {
    model?: Record<string, Record<string, number>>;
  };
  expect(typeof onDisk.model).toBe("object");
  expect(onDisk.model).not.toBeNull();
});

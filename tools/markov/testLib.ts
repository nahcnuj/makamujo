/**
 * コマンドの単体テストで共有する小さな道具（git の `t/test-lib.sh` と同じ位置づけ）。
 * 製品コードからは読まない。コマンドごとに `commands/<name>.test.ts` から使う。
 *
 * - `modelFixture`: `<modelPath>` になるモデルファイルを作る（`var/` の一時領域）
 * - `captureOutput`: `run` のあいだに出力先を差し替えて stdout / stderr を集める
 * - `csvRows`: CSV 出力を行ごとの列に割る
 */

import { spyOn } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ModelJson } from "./modelFile";

/** 一時領域の根。テストごとに作り、テストの終わりに消す。 */
const workRoot = join(import.meta.dir, "../../var/tmp-markov-unit-test");

/** 1 テストぶんのモデルファイル。 */
export type ModelFixture = {
  /** `<modelPath>` に渡すパス。 */
  readonly modelPath: string;
  /** 一時ディレクトリを消す。 */
  readonly remove: () => void;
};

/** label ごとの作業ディレクトリ（`var/tmp-markov-unit-test/<label>`）。 */
export const modelFixture = (label: string, json: ModelJson): ModelFixture => {
  const directory = join(workRoot, label);
  const modelPath = join(directory, "model.json");
  mkdirSync(directory, { recursive: true });
  writeFileSync(modelPath, JSON.stringify(json), "utf8");
  return {
    modelPath,
    remove: () => rmSync(directory, { recursive: true, force: true }),
  };
};

/** 集めた出力。 */
export type CommandOutput = {
  /** stdout。`console.log` と `process.stdout.write` を順に並べたもの。 */
  readonly stdout: string;
  /** stderr。`console.error` の行を改行でつないだもの。 */
  readonly stderr: string;
};

/**
 * `run` のあいだに出力先を差し替える（戻したら必ず復元する）。
 * コマンドは `console.log` / `console.error` / `process.stdout.write` で喋るので 3 つとも取る。
 */
export const captureOutput = (run: () => void): CommandOutput => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const line = (parts: readonly unknown[]): string =>
    parts.map((part) => String(part)).join(" ");
  const log = spyOn(console, "log").mockImplementation(
    (...parts: unknown[]) => {
      stdout.push(`${line(parts)}\n`);
    },
  );
  const error = spyOn(console, "error").mockImplementation(
    (...parts: unknown[]) => {
      stderr.push(line(parts));
    },
  );
  const write = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  try {
    run();
  } finally {
    log.mockRestore();
    error.mockRestore();
    write.mockRestore();
  }
  return { stdout: stdout.join(""), stderr: stderr.join("\n") };
};

/**
 * CSV 出力を行ごとの列に割る（ヘッダーも 1 行として含む）。
 * 引用符の中のカンマは扱わない（引用符は `output.test.ts` で確かめる）。
 */
export const csvRows = (stdout: string): string[][] =>
  stdout
    .trim()
    .split("\n")
    .map((line) => line.split(","));

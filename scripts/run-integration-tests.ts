#!/usr/bin/env bun
/**
 * Run integration tests one file at a time so server-spawning suites do not
 * race on ports / IPC (especially on Windows).
 *
 * Usage: bun run scripts/run-integration-tests.ts
 *        bun run test:integration
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dir, "..");
const integrationDir = join(root, "tests", "integration");

const collectTestFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectTestFiles(full));
    } else if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out.sort();
};

const files = collectTestFiles(integrationDir);
if (files.length === 0) {
  console.error("No integration test files found under tests/integration");
  process.exit(1);
}

console.log(`[integration] running ${files.length} file(s) serially`);

let failed = 0;
for (const file of files) {
  const rel = relative(root, file).replaceAll("\\", "/");
  console.log(`\n[integration] >>> ${rel}`);
  const result = spawnSync("bun", ["test", file], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  const code = result.status ?? 1;
  if (code !== 0) {
    console.error(`[integration] FAIL ${rel} (exit ${code})`);
    failed += 1;
  } else {
    console.log(`[integration] OK   ${rel}`);
  }
}

if (failed > 0) {
  console.error(`\n[integration] ${failed}/${files.length} file(s) failed`);
  process.exit(1);
}

console.log(`\n[integration] all ${files.length} file(s) passed`);

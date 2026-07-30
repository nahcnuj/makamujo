import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const tmpDir = join(import.meta.dir, "../../var/tmp-markov-cli-test");
const modelPath = join(tmpDir, "model.json");

describe("markov cli transitions", () => {
  it("prints fromContexts with visible n-gram separator", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({
        model: {
          "": { "パンティー": 5 },
          "パンティー": { "。": 10 },
          ["ベージュ" + String.fromCharCode(0) + "パンティー"]: { "。": 9 },
          "の": { "パンティー": 4 },
        },
        corpus: [],
      }),
    );

    const proc = Bun.spawn(
      ["bun", "run", "tools/markov/cli.ts", "transitions", modelPath, "パンティー"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.split("\n")[0]).toBe("direction,context,other,weight");
    expect(stdout).toContain("from,ベージュ/パンティー,。,9");
    expect(stdout).toContain("from,パンティー,。,10");
    expect(stdout).toContain("to,の,パンティー,4");

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("markov cli decrement-phrase", () => {
  it("logs changed transitions to stderr and model JSON to stdout", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({
        model: {
          "": { beige: 2 },
          beige: { panty: 3 },
          panty: { "\u3002": 1 },
        },
        corpus: [],
      }),
    );

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "tools/markov/cli.ts",
        "decrement-phrase",
        modelPath,
        "beige panty",
        "--delta",
        "1",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;

    expect(code).toBe(0);
    expect(stderr).toContain('tokens=["beige","panty"]');
    expect(stderr).toContain("(BOS) -> beige: 2 => 1");
    expect(stderr).toContain("beige -> panty: 3 => 2");
    expect(stderr).toContain("changed: 2 transitions");

    const out = JSON.parse(stdout);
    expect(out.model[""].beige).toBe(1);
    expect(out.model.beige.panty).toBe(2);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("markov cli decrement-phrase --in-place", () => {
  it("in-place writes model back without stdout JSON", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({
        model: {
          "": { beige: 2 },
          beige: { panty: 3 },
        },
        corpus: [],
      }),
    );

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "tools/markov/cli.ts",
        "decrement-phrase",
        "-i",
        modelPath,
        "beige panty",
        "--delta",
        "1",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;

    expect(code).toBe(0);
    expect(stdout.trim()).toBe("");
    expect(stderr).toContain("changed:");
    expect(stderr).toContain("wrote:");

    const saved = JSON.parse(require("fs").readFileSync(modelPath, "utf8"));
    expect(saved.model[""].beige).toBe(1);
    expect(saved.model.beige.panty).toBe(2);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("markov cli decrement-phrase -iSUFFIX", () => {
  it("writes backup with suffix then overwrites model", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({
        model: { "": { beige: 2 }, beige: { panty: 3 } },
        corpus: [],
      }),
    );

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "tools/markov/cli.ts",
        "decrement-phrase",
        modelPath,
        "beige panty",
        "--delta",
        "1",
        "-i.bak",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;

    expect(code).toBe(0);
    expect(stdout.trim()).toBe("");
    expect(stderr).toContain("backup:");
    expect(stderr).toContain("wrote:");

    const backup = JSON.parse(require("fs").readFileSync(modelPath + ".bak", "utf8"));
    expect(backup.model[""].beige).toBe(2);

    const saved = JSON.parse(require("fs").readFileSync(modelPath, "utf8"));
    expect(saved.model[""].beige).toBe(1);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("markov cli search visibility", () => {
  it("search prints n-gram keys with slash", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({
        model: {
          "": { "パンティー": 1 },
          ["ベージュ" + String.fromCharCode(0) + "パンティー"]: { "。": 2 },
        },
        corpus: [],
      }),
    );

    const proc = Bun.spawn(
      ["bun", "run", "tools/markov/cli.ts", "search", modelPath, "パンティー"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(stdout).toContain("ベージュ/パンティー");
    expect(stdout.includes(String.fromCharCode(0))).toBe(false);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("markov cli delimiter", () => {
  it("decrement-phrase accepts slash delimiter", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({
        model: {
          "": { beige: 2 },
          beige: { panty: 3 },
        },
        corpus: [],
      }),
    );

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "tools/markov/cli.ts",
        "decrement-phrase",
        modelPath,
        "beige/panty",
        "--delta",
        "1",
        "-d/",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(stderr).toContain('tokens=["beige","panty"]');
    expect(stderr).toContain("changed:");

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { helpText } from "./command";
import { markovCommands } from "./commands";
import { decrementPhrase } from "./commands/decrementPhrase";

const tmpDir = join(import.meta.dir, "../../var/tmp-markov-cli-test");
const modelPath = join(tmpDir, "model.json");

describe("markov cli transitions", () => {
  it("prints fromContexts with visible n-gram separator", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({
        model: {
          "": { パンティー: 5 },
          パンティー: { "。": 10 },
          ["ベージュ" + String.fromCharCode(0) + "パンティー"]: { "。": 9 },
          の: { パンティー: 4 },
        },
        corpus: [],
      }),
    );

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "tools/markov/cli.ts",
        "transitions",
        modelPath,
        "パンティー",
      ],
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

describe("markov cli decrement-phrase --suffix", () => {
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
        "--suffix",
        ".bak",
        "-i",
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

    const backup = JSON.parse(
      require("fs").readFileSync(modelPath + ".bak", "utf8"),
    );
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
          "": { パンティー: 1 },
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

describe("markov cli decrement-phrase --purge", () => {
  it("rejects --purge with --delta", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({ model: { "": { a: 1 } }, corpus: [] }),
    );
    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "tools/markov/cli.ts",
        "decrement-phrase",
        modelPath,
        "a",
        "--purge",
        "--delta",
        "1",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect(code).toBe(1);
    expect(stderr).toContain("--purge and --delta cannot be used together");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("purge removes token edges", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({
        model: { "": { beige: 2, x: 1 }, no: { beige: 3 } },
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
        "beige",
        "--purge",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(stderr).toContain("purge");
    const out = JSON.parse(stdout);
    expect(out.model[""]?.beige).toBeUndefined();
    expect(out.model[""]?.x).toBe(1);
    expect(out.model.no?.beige).toBeUndefined();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("markov cli tokens", () => {
  it("tokens sorts by column", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({
        model: {
          "": { b: 1, a: 5 },
          a: { x: 1 },
          b: { x: 1, y: 1 },
        },
        corpus: [],
      }),
    );

    const run = async (args: string[]) => {
      const proc = Bun.spawn(
        ["bun", "run", "tools/markov/cli.ts", "tokens", modelPath, ...args],
        { stdout: "pipe", stderr: "pipe" },
      );
      const stdout = await new Response(proc.stdout).text();
      const code = await proc.exited;
      expect(code).toBe(0);
      return stdout
        .trim()
        .split("\n")
        .slice(1)
        .map((l) => l.split(",")[0]);
    };

    const byToken = await run(["--sort", "token"]);
    expect(byToken).toEqual(["a", "b", "x", "y"]);

    const byTo = await run(["--sort", "asToWeight"]);
    expect(byTo[0]).toBe("a"); // asToWeight 5

    const byFrom = await run(["--sort", "asFrom"]);
    expect(byFrom[0]).toBe("b"); // asFrom 2

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects unknown --sort", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({ model: { "": { a: 1 } }, corpus: [] }),
    );
    const proc = Bun.spawn(
      [
        "bun",
        "run",
        "tools/markov/cli.ts",
        "tokens",
        modelPath,
        "--sort",
        "nope",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const code = await proc.exited;
    expect(code).toBe(1);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("markov cli corpus", () => {
  it("lists corpus with from-end index", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({
        model: { "": { "。": 1 } },
        corpus: ["古い。", "新しい。"],
      }),
    );

    const proc = Bun.spawn(
      ["bun", "run", "tools/markov/cli.ts", "corpus", modelPath],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(stdout).toContain("2\t古い。");
    expect(stdout).toContain("1\t新しい。");
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("markov cli unlearn", () => {
  it("without -i writes JSON to stdout and does not change file", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const model = {
      model: {
        "": { あ: 1 },
        あ: { "。": 1 },
      },
      corpus: ["あ。"],
    };
    writeFileSync(modelPath, JSON.stringify(model));

    const proc = Bun.spawn(
      ["bun", "run", "tools/markov/cli.ts", "unlearn", modelPath, "1"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(stderr).toContain("unlearn n=1");
    const out = JSON.parse(stdout);
    expect(out.corpus).toEqual([]);
    const onDisk = JSON.parse(await Bun.file(modelPath).text());
    expect(onDisk.corpus).toEqual(["あ。"]);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("with -i overwrites model file", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({
        model: { "": { あ: 1 }, あ: { "。": 1 } },
        corpus: ["あ。"],
      }),
    );

    const proc = Bun.spawn(
      ["bun", "run", "tools/markov/cli.ts", "unlearn", modelPath, "1", "-i"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("");
    expect(stderr).toContain("wrote:");
    const saved = JSON.parse(await Bun.file(modelPath).text());
    expect(saved.corpus).toEqual([]);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("markov cli per-command options", () => {
  const runCli = async (args: string[]) => {
    const proc = Bun.spawn(["bun", "run", "tools/markov/cli.ts", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    return { stdout, stderr, code };
  };

  it("rejects options that belong to a different command", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(modelPath, JSON.stringify({ model: {}, corpus: [] }));

    const { stderr, code } = await runCli([
      "transitions",
      modelPath,
      "word",
      "--tail",
      "3",
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain("--tail");
    expect(stderr).toContain(
      "bun run markov transitions <modelPath> <word> [-d]",
    );

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects --sort for a command other than tokens", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(modelPath, JSON.stringify({ model: {}, corpus: [] }));

    const { stderr, code } = await runCli([
      "search",
      modelPath,
      "query",
      "--sort",
      "token",
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain("--sort");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("still accepts --tail for corpus", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      modelPath,
      JSON.stringify({ model: {}, corpus: ["古い。", "新しい。"] }),
    );

    const { stdout, code } = await runCli(["corpus", modelPath, "--tail", "1"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("1\t新しい。");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("--help exits 0 and prints the whole table", async () => {
    const { stderr, code } = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(stderr.trim()).toBe(helpText(markovCommands));
  });

  it("<command> --help exits 0 and prints only that command", async () => {
    const { stderr, code } = await runCli(["decrement-phrase", "--help"]);
    expect(code).toBe(0);
    expect(stderr.trim()).toBe(decrementPhrase.help);
    expect(stderr).toContain("--purge");
    expect(stderr).not.toContain("--tail");
  });

  it("<command> --help shows only the help flag when there is no option", async () => {
    const { stderr, code } = await runCli(["search", "--help"]);
    expect(code).toBe(0);
    expect(stderr).toContain("bun run markov search <modelPath> <query>");
    expect(stderr).toContain("-h, --help");
    expect(stderr).not.toContain("--sort");
  });

  it("no command exits 1", async () => {
    const { stderr, code } = await runCli([]);
    expect(code).toBe(1);
    expect(stderr).toContain("Usage:");
  });

  it("unknown command exits 1", async () => {
    const { stderr, code } = await runCli(["bogus"]);
    expect(code).toBe(1);
    expect(stderr).toContain("unknown command: bogus");
  });
});

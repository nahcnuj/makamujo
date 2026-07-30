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

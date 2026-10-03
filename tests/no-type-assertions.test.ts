/**
 * Guards for #435 (`as unknown as T` avoidance) and for the Biome plugin that
 * enforces it.
 *
 * The plugin is enabled repo-wide. Existing assertions that could not be
 * rewritten cheaply carry a `biome-ignore lint/plugin/no-type-assertion`
 * comment with a reason, so the rule is enforced for everything new while the
 * migration proceeds. Two invariants are therefore checked here:
 *
 * 1. the plugin is configured and actually loaded,
 * 2. the `as unknown as` double cast — the construct the issue calls out — does
 *    not appear anywhere in first-party source, so the issue's goal holds even
 *    where a single `as` is still tolerated under an explicit ignore.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

const repoRoot = join(import.meta.dir, "..");

const readBiomeConfig = () =>
  JSON.parse(readFileSync(join(repoRoot, "biome.json"), "utf8")) as {
    plugins?: string[];
  };

const pluginPaths = (): string[] => readBiomeConfig().plugins ?? [];

const findPluginPath = (): string =>
  pluginPaths().find((path) =>
    path.includes("biome-plugin-no-type-assertion"),
  ) ?? "";

describe("biome-plugin-no-type-assertion configuration", () => {
  test("the plugin is enabled repo-wide, not per-path", () => {
    const plugins = pluginPaths();
    expect(plugins.length).toBeGreaterThan(0);
    expect(
      plugins.some((p) => p.includes("biome-plugin-no-type-assertion")),
    ).toBe(true);
  });

  test("the plugin file is resolvable from the configuration", () => {
    const plugin = findPluginPath();
    expect(plugin).not.toBe("");
    // Biome resolves `plugins` relative to the configuration file.
    expect(readFileSync(join(repoRoot, plugin), "utf8")).toContain(
      "TsAsExpression",
    );
  });

  test("the plugin ignores `as const`, which the codebase relies on", () => {
    // AGENTS.md sanctions `as const` / `satisfies` for narrowing, so a plugin
    // that flagged them would be unusable here.
    expect(readFileSync(join(repoRoot, findPluginPath()), "utf8")).toContain(
      '! $type <: "const"',
    );
  });
});

describe("no double type assertions", () => {
  const sourceFiles = [...new Glob("**/*.{ts,tsx}").scanSync({ cwd: repoRoot })]
    .filter(
      (path) =>
        !path.includes("node_modules") &&
        !path.includes("var/") &&
        !path.includes("test-results") &&
        !path.endsWith(".d.ts"),
    )
    // Test files are exempt from the linter (biome.json overrides) and
    // legitimately need assertions to build fixtures.
    .filter((path) => !/\.test\.tsx?$/.test(path))
    .map((path) => path.replaceAll("\\", "/"));

  test("the scan found the source tree", () => {
    expect(sourceFiles.length).toBeGreaterThan(20);
  });

  for (const [label, pattern] of [
    ["as unknown as", /\bas\s+unknown\s+as\b/],
    ["as any as", /\bas\s+any\s+as\b/],
  ] as const) {
    test(`no \`${label}\` survives`, () => {
      const offenders = sourceFiles.filter((path) =>
        pattern.test(readFileSync(join(repoRoot, path), "utf8")),
      );
      expect(offenders).toEqual([]);
    });
  }
});

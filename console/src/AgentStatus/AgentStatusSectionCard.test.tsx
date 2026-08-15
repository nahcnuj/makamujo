import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "hono/jsx/dom/server";
import { AgentStatusSectionCard } from "./AgentStatusSectionCard";

describe("AgentStatusSectionCard row keys", () => {
  it("renders updated speech value without relying on value in key", () => {
    const html = renderToString(
      <AgentStatusSectionCard
        title="status"
        rows={[{ label: "発話内容", value: "second utterance" }]}
      />,
    );
    expect(html).toContain("発話内容");
    expect(html).toContain("second utterance");
  });

  it("does not put row.value into the React key expression", () => {
    const srcPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "AgentStatusSectionCard.tsx",
    );
    const src = readFileSync(srcPath, "utf8");
    const keyLine = src
      .split("\n")
      .find((l) => l.includes("key={`") && l.includes("row.label"));
    expect(keyLine).toBeDefined();
    expect(keyLine).not.toContain("row.value");
  });
});

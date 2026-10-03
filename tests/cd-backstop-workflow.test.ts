import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const workflowsDir = ".github/workflows";

const parseWorkflow = (name: string): Record<string, unknown> =>
  Bun.YAML.parse(readFileSync(`${workflowsDir}/${name}`, "utf8")) as Record<
    string,
    unknown
  >;

describe("CD backstop workflow", () => {
  const workflow = parseWorkflow("cd-backstop.yml");

  it("parses and is named", () => {
    expect(workflow.name).toBe("CD backstop");
  });

  it("runs on a schedule, which GitHub dispatches regardless of the merge token", () => {
    // `on: push` is suppressed when the merge used GITHUB_TOKEN or a GitHub App
    // installation token (#677), so the schedule is the only hook that can
    // start CD for such merges.
    const triggers = workflow.on as {
      schedule?: { cron?: string[] }[];
      workflow_dispatch?: unknown;
    };
    expect(triggers.schedule?.length).toBeGreaterThan(0);
    expect(triggers.schedule?.[0]?.cron?.length).toBeGreaterThan(0);
    expect(triggers.workflow_dispatch).toBeDefined();
  });

  it("has the permissions the backstop script needs", () => {
    const permissions = workflow.permissions as Record<string, string>;
    // `gh workflow run` needs actions:write; `gh api .../deployments` needs
    // deployments:read.
    expect(permissions.actions).toBe("write");
    expect(permissions.deployments).toBe("read");
    expect(permissions.contents).toBe("read");
  });

  it("invokes the decision script rather than reimplementing it", () => {
    const jobs = workflow.jobs as Record<
      string,
      { steps?: { run?: string; env?: Record<string, string> }[] }
    >;
    const step = jobs.dispatch?.steps?.find((s) => s.run !== undefined);
    // The logic lives in scripts/ so tests/bin can exercise it without a
    // network connection; the workflow only has to hand over the repo slug.
    expect(step?.run).toContain("scripts/cd-backstop.sh");
    expect(step?.env?.GH_REPO).toBe("${{ github.repository }}");
    expect(step?.env?.GH_TOKEN).toBe("${{ secrets.GITHUB_TOKEN }}");
  });

  it("checks out the repository so the script is present", () => {
    const jobs = workflow.jobs as Record<
      string,
      { steps?: { uses?: string }[] }
    >;
    const uses = (jobs.dispatch?.steps ?? []).map((step) => step.uses ?? "");
    expect(uses.some((u) => u.startsWith("actions/checkout@"))).toBeTrue();
  });
});

describe("CD and CI workflows stay dispatchable", () => {
  it("cd.yml can be dispatched by the backstop", () => {
    const triggers = parseWorkflow("cd.yml").on as Record<string, unknown>;
    expect(triggers.workflow_dispatch).toBeDefined();
  });

  it("ci.yml can be dispatched by cd.yml when no push run exists", () => {
    const triggers = parseWorkflow("ci.yml").on as Record<string, unknown>;
    expect(triggers.workflow_dispatch).toBeDefined();
  });

  it("the backstop does not share cd.yml's concurrency group", () => {
    // Sharing a group would let a backstop run cancel or queue against the
    // deploy it is meant to trigger.
    const backstop = parseWorkflow("cd-backstop.yml").concurrency as {
      group: string;
    };
    const cd = parseWorkflow("cd.yml").concurrency as { group: string };
    expect(backstop.group).not.toBe(cd.group);
  });
});

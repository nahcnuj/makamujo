import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const cdWorkflow = readFileSync(".github/workflows/cd.yml", "utf-8");
const deployPlaybook = readFileSync(
  "ansible/playbooks/2_makamujo.yml",
  "utf-8",
);

test("CD workflow deploys from main only after CI for that commit succeeds", () => {
  expect(cdWorkflow).toContain("name: CD");
  expect(cdWorkflow).toMatch(
    /on:\s*\r?\n\s*push:\s*\r?\n\s*branches:\s*\r?\n\s*-\s*main/,
  );
  expect(cdWorkflow).not.toContain("pull_request:");
  expect(cdWorkflow).not.toContain("workflow_dispatch:");
  expect(cdWorkflow).toContain("wait-for-ci:");
  expect(cdWorkflow).toContain("needs: wait-for-ci");
  expect(cdWorkflow).toContain('gh run list --workflow ci.yml --commit "$SHA"');
  expect(cdWorkflow).toContain("playbooks/2_makamujo.yml");
  expect(cdWorkflow).not.toContain("makamujo_git_version=");
  expect(cdWorkflow).toContain("environment: vps");
  expect(cdWorkflow).toContain("secrets.VPS_SSH_PRIVATE_KEY != ''");
  expect(cdWorkflow).not.toContain(":?missing secret");
});

test("deploy playbook checks out main without extra-var overrides", () => {
  expect(deployPlaybook).toContain(
    "repo: https://github.com/nahcnuj/makamujo.git",
  );
  expect(deployPlaybook).toMatch(/version:\s+main\s*$/m);
  expect(deployPlaybook).not.toContain("makamujo_git_version");
  expect(deployPlaybook).not.toContain("makamujo_git_repo");
});

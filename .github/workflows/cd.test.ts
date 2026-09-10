import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const cdWorkflow = readFileSync(".github/workflows/cd.yml", "utf-8");
const deployPlaybook = readFileSync(
  "ansible/playbooks/2_makamujo.yml",
  "utf-8",
);
const ansibleVars = readFileSync(
  "ansible/inventory/group_vars/all/vars.yml",
  "utf-8",
);

test("CD workflow deploys from main only after CI for that commit succeeds", () => {
  expect(cdWorkflow).toContain("name: CD");
  expect(cdWorkflow).toMatch(
    /on:\s*\r?\n\s*push:\s*\r?\n\s*branches:\s*\r?\n\s*-\s*main/,
  );
  expect(cdWorkflow).not.toContain("pull_request:");
  expect(cdWorkflow).toContain("wait-for-ci:");
  expect(cdWorkflow).toContain("needs: wait-for-ci");
  expect(cdWorkflow).toContain("github.ref == 'refs/heads/main'");
  expect(cdWorkflow).toContain('gh run list --workflow ci.yml --commit "$SHA"');
  expect(cdWorkflow).toContain("playbooks/2_makamujo.yml");
  expect(cdWorkflow).toContain("makamujo_git_version=${GITHUB_SHA}");
  expect(cdWorkflow).toContain("environment: vps");
});

test("deploy playbook checks out a configurable git version", () => {
  expect(ansibleVars).toContain("makamujo_git_version: main");
  expect(ansibleVars).toContain("makamujo_git_repo:");
  expect(deployPlaybook).toContain('repo: "{{ makamujo_git_repo }}"');
  expect(deployPlaybook).toContain('version: "{{ makamujo_git_version }}"');
  expect(deployPlaybook).not.toMatch(/version:\s+main\s*$/m);
});

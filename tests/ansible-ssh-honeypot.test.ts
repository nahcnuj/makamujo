import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const playbook = readFileSync("ansible/playbooks/0_ssh_honeypot.yml", "utf-8");
const deploySh = readFileSync("bin/deploy.sh", "utf-8");
const cdYml = readFileSync(".github/workflows/cd.yml", "utf-8");
const ansibleReadme = readFileSync("ansible/README.md", "utf-8");

test("sshd stays on port 22 and only accepts publickey", () => {
  expect(playbook).toContain("hosts: vps");
  expect(playbook).toContain("Port 22");
  expect(playbook).toContain("AuthenticationMethods publickey");
  expect(playbook).toContain("PasswordAuthentication no");
  expect(playbook).toContain("PubkeyAuthentication yes");
  expect(playbook).not.toContain("- endlessh");
  expect(playbook).not.toContain("/etc/endlessh");
  expect(playbook).not.toContain("22222");
});

test("failed key auth is held then silenced", () => {
  expect(playbook).toContain("LoginGraceTime 0");
  expect(playbook).toContain("PerSourceMaxStartups 1");
  expect(playbook).toContain("MaxAuthTries 1");
  expect(playbook).toContain("fail2ban");
  expect(playbook).toContain("blocktype=DROP");
  expect(playbook).toContain("bantime = -1");
});

test("sshd is reloaded not restarted so the applying SSH session survives", () => {
  expect(playbook).toContain("name: ssh");
  expect(playbook).toContain("state: reloaded");
  expect(playbook).not.toContain("state: restarted");
});

test("deploy.sh can run the honeypot playbook without moving SSH off 22", () => {
  expect(deploySh).toContain("DEPLOY_PLAYBOOK");
  expect(deploySh).not.toContain("vps-ssh-port");
  expect(deploySh).not.toContain("ansible_port");
});

test("CD arms the honeypot before app deploy and still key-scans port 22", () => {
  expect(cdYml).toContain(
    "DEPLOY_PLAYBOOK=ansible/playbooks/0_ssh_honeypot.yml bash bin/deploy.sh",
  );
  const honeypotIndex = cdYml.indexOf("0_ssh_honeypot.yml");
  const appDeployIndex = cdYml.lastIndexOf("bash bin/deploy.sh");
  expect(honeypotIndex).toBeGreaterThanOrEqual(0);
  expect(appDeployIndex).toBeGreaterThan(honeypotIndex);
  expect(cdYml).toContain('ssh-keyscan -H "$VPS_SSH_HOST"');
  expect(cdYml).not.toContain("vps-ssh-port");
});

test("ansible README documents pubkey-only silence on port 22", () => {
  expect(ansibleReadme).toContain("0_ssh_honeypot.yml");
  expect(ansibleReadme).toContain("LoginGraceTime 0");
  expect(ansibleReadme).toContain("DROP");
  expect(ansibleReadme).not.toContain("Endlessh");
  expect(ansibleReadme).not.toContain("22222");
  expect(ansibleReadme).not.toContain("VPS_SSH_PORT");
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const playbook = readFileSync("ansible/playbooks/0_ssh_honeypot.yml", "utf-8");
const varsFile = readFileSync("ansible/inventory/group_vars/all/vars.yml", "utf-8");
const deploySh = readFileSync("bin/deploy.sh", "utf-8");
const cdYml = readFileSync(".github/workflows/cd.yml", "utf-8");
const ansibleReadme = readFileSync("ansible/README.md", "utf-8");

test("management SSH port is 22222 and tarpit stays on 22", () => {
  expect(varsFile).toContain("ssh_management_port: 22222");
  expect(varsFile).toContain("ssh_tarpit_port: 22");
  expect(playbook).toContain("hosts: vps");
  expect(playbook).toContain("endlessh");
  expect(playbook).toContain("Port {{ ssh_tarpit_port | int }}");
  expect(playbook).toContain("Delay 10000");
  expect(playbook).toContain("MaxClients 4096");
});

test("Endlessh can bind port 22 without editing the distro unit file", () => {
  expect(playbook).toContain("AmbientCapabilities=CAP_NET_BIND_SERVICE");
  expect(playbook).toContain("PrivateUsers=false");
  expect(playbook).toContain("/etc/systemd/system/endlessh.service.d/override.conf");
});

test("sshd is reloaded not restarted so the applying SSH session survives", () => {
  expect(playbook).toContain("name: ssh");
  expect(playbook).toContain("state: reloaded");
  expect(playbook).not.toMatch(/name: ssh\s+state: restarted/);
  expect(playbook).not.toContain("state: restarted");
});

test("sshd leaves 22 only after the management port is confirmed on loopback", () => {
  expect(playbook).toContain("Temporarily dual-listen sshd on tarpit and management ports");
  expect(playbook).toContain("when: ssh_management_listen.rc != 0");
  expect(playbook).toContain("host: 127.0.0.1");
  expect(playbook).toContain("Wait until sshd listens on the management port");
  expect(playbook).toContain("Wait until the tarpit port is free for Endlessh");
  expect(playbook).toContain("state: stopped");
});

test("deploy.sh probes the management port and times out instead of sitting in the tarpit", () => {
  expect(deploySh).toContain('ansible_port="$("${script_dir}/vps-ssh-port")"');
  expect(deploySh).toContain("-e \"ansible_port=${ansible_port}\"");
  expect(deploySh).toContain("ConnectTimeout=10");
  expect(deploySh).toContain("DEPLOY_PLAYBOOK");
});

test("CD arms Endlessh before app deploy and key-scans the probed port", () => {
  expect(cdYml).toContain(
    "DEPLOY_PLAYBOOK=ansible/playbooks/0_ssh_honeypot.yml bash bin/deploy.sh",
  );
  const honeypotIndex = cdYml.indexOf("0_ssh_honeypot.yml");
  const appDeployIndex = cdYml.lastIndexOf("bash bin/deploy.sh");
  expect(honeypotIndex).toBeGreaterThanOrEqual(0);
  expect(appDeployIndex).toBeGreaterThan(honeypotIndex);
  expect(cdYml).toContain('ssh-keyscan -p "$ssh_port"');
  expect(cdYml).toContain("bash bin/vps-ssh-port");
});

test("ansible README documents the tarpit and the management port", () => {
  expect(ansibleReadme).toContain("0_ssh_honeypot.yml");
  expect(ansibleReadme).toContain("Endlessh");
  expect(ansibleReadme).toContain("22222");
  expect(ansibleReadme).toContain("VPS_SSH_PORT");
});

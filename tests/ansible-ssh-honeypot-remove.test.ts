import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("removal playbook deletes the honeypot sshd drop-in", () => {
  const playbook = readFileSync(
    "ansible/playbooks/0_ssh_honeypot_remove.yml",
    "utf-8",
  );
  expect(playbook).toContain(
    "/etc/ssh/sshd_config.d/99-makamujo-honeypot.conf",
  );
  expect(playbook).toContain("state: absent");
});

test("removal playbook cleans up fail2ban honeypot artifacts", () => {
  const playbook = readFileSync(
    "ansible/playbooks/0_ssh_honeypot_remove.yml",
    "utf-8",
  );
  expect(playbook).toContain("/etc/fail2ban/jail.d/sshd-honeypot.conf");
  expect(playbook).toContain("/etc/fail2ban/action.d/honeypot-report.conf");
  expect(playbook).toContain("/usr/local/bin/honeypot-report");
});

test("deploy playbook also removes leftover honeypot state", () => {
  const playbook = readFileSync("ansible/playbooks/2_makamujo.yml", "utf-8");
  expect(playbook).toContain(
    "/etc/ssh/sshd_config.d/99-makamujo-honeypot.conf",
  );
  expect(playbook).toContain("/etc/fail2ban/jail.d/sshd-honeypot.conf");
});

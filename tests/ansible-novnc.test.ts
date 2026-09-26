import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const UNIT_DEST = "/etc/systemd/system/makamujo-novnc.service";

const extractUnitContent = (playbookPath: string, dest: string): string => {
  const lines = readFileSync(playbookPath, "utf-8").split("\n");
  const destLineIndex = lines.findIndex((line) =>
    line.includes(`dest: ${dest}`),
  );
  expect(destLineIndex).toBeGreaterThanOrEqual(0);

  const contentLineIndex = lines.findIndex(
    (line, index) => index > destLineIndex && line.trim() === "content: |",
  );
  expect(contentLineIndex).toBeGreaterThan(destLineIndex);

  const blockIndent = " ".repeat(10);
  const body: string[] = [];
  for (const line of lines.slice(contentLineIndex + 1)) {
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (!line.startsWith(blockIndent)) break;
    body.push(line.slice(blockIndent.length));
  }
  while (body.at(-1) === "") body.pop();
  expect(body.length).toBeGreaterThan(0);
  return `${body.join("\n")}\n`;
};

test("noVNC packages are provisioned by the desktop playbook", () => {
  const playbook = readFileSync("ansible/playbooks/0_desktop.yml", "utf-8");
  const taskIndex = playbook.indexOf(
    "Install noVNC packages (browser VNC client for :10)",
  );
  expect(taskIndex).toBeGreaterThanOrEqual(0);

  const taskBlock = playbook.slice(
    taskIndex,
    playbook.indexOf("- name:", taskIndex + 1),
  );
  expect(taskBlock).toContain("novnc");
  expect(taskBlock).toContain("websockify");
});

test("makamujo noVNC unit bridges the loopback x11vnc endpoint over websockify", () => {
  const unit = extractUnitContent("ansible/playbooks/0_desktop.yml", UNIT_DEST);

  expect(unit).toContain("ExecStart=/usr/bin/websockify");
  expect(unit).toContain("--web /usr/share/novnc");
  expect(unit).toContain("127.0.0.1:6080 127.0.0.1:5900");
  expect(unit).toContain(
    "Requires=makamujo-xvfb.service makamujo-x11vnc.service",
  );
  expect(unit).toContain("After=makamujo-xvfb.service makamujo-x11vnc.service");
  expect(unit).toContain("Restart=on-failure");
  expect(unit).toContain("WantedBy=multi-user.target");
});

test("noVNC stays bound to loopback because :10 exposes OBS without authentication", () => {
  const unit = extractUnitContent("ansible/playbooks/0_desktop.yml", UNIT_DEST);
  const execStart = unit
    .split("\n")
    .find((line) => line.startsWith("ExecStart="));

  expect(execStart).toBeDefined();
  expect(execStart).not.toContain("0.0.0.0");
  expect(execStart).not.toContain("::");
  expect(execStart).not.toMatch(/--?listen|:[0-9]+\s+localhost/);
});

test("noVNC is installed but never enabled at boot, so it only runs during reserve.ts", () => {
  const desktop = readFileSync("ansible/playbooks/0_desktop.yml", "utf-8");
  const taskIndex = desktop.indexOf(
    "Install makamujo noVNC unit (on-demand, started by bin/x/reserve.ts only)",
  );
  expect(taskIndex).toBeGreaterThanOrEqual(0);

  const taskEnd = desktop.indexOf("- name:", taskIndex + 1);
  const unitTask = desktop.slice(taskIndex, taskEnd);
  expect(unitTask).toContain(`dest: ${UNIT_DEST}`);

  const desktopTasks = [...desktop.matchAll(/^ {4}- name: (.+)$/gm)].map(
    (match) => match[1] ?? "",
  );
  expect(desktopTasks).not.toContain("Enable and start makamujo-novnc");
  expect(
    desktopTasks.filter((name) => name.includes("makamujo-novnc")).length,
  ).toBe(0);

  const novncSystemdTasks = [...desktop.matchAll(/name: (makamujo-novnc)/g)];
  expect(novncSystemdTasks).toHaveLength(0);
});

test("the deploy playbook leaves noVNC alone so CD cannot keep it running", () => {
  const deploy = readFileSync("ansible/playbooks/2_makamujo.yml", "utf-8");
  const infraIndex = deploy.indexOf("Restart streaming infra");
  expect(infraIndex).toBeGreaterThanOrEqual(0);

  const infraBlock = deploy.slice(
    infraIndex,
    deploy.indexOf("wait_for", infraIndex),
  );
  expect(infraBlock).toContain("makamujo-x11vnc.service");
  expect(infraBlock).not.toContain("makamujo-novnc.service");
  expect(deploy).not.toContain("makamujo-novnc.service");
});

test("reserve.ts owns the noVNC lifecycle and closes the browser on failure", () => {
  const reserve = readFileSync("bin/x/reserve.ts", "utf-8");

  expect(reserve).toContain("setNoVncRunning(true, runSystemctl)");
  expect(reserve).toContain("setNoVncRunning(false, runSystemctl)");
  expect(reserve).toContain("await startNoVnc();");
  expect(reserve).toContain("await stopNoVnc();");

  const startIndex = reserve.indexOf("await startNoVnc();");
  const stopIndex = reserve.indexOf("await stopNoVnc();");
  const loopIndex = reserve.indexOf("do {");
  const finallyIndex = reserve.indexOf("} finally {");

  expect(startIndex).toBeLessThan(loopIndex);
  expect(stopIndex).toBeGreaterThan(loopIndex);
  expect(finallyIndex).toBeGreaterThan(loopIndex);
  expect(reserve).toContain(
    "} finally {\n  await stopNoVnc();\n  await ctx.close();",
  );
});

test("reserve.ts waits for a human sign-in before touching Niconico", () => {
  const reserve = readFileSync("bin/x/reserve.ts", "utf-8");

  expect(reserve).toContain("hasNiconicoSession(await readCookies())");
  expect(reserve).toContain("waitForNiconicoSession(readCookies, {");

  const signInIndex = reserve.indexOf("waitForNiconicoSession");
  const firstPageUse = reserve.indexOf("garage.nicovideo.jp");
  expect(signInIndex).toBeLessThan(firstPageUse);
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const NOVNC_UNIT_DEST = "/etc/systemd/system/makamujo-novnc.service";
const LOGIN_XVFB_UNIT_DEST = "/etc/systemd/system/makamujo-login-xvfb.service";
const LOGIN_X11VNC_UNIT_DEST =
  "/etc/systemd/system/makamujo-login-x11vnc.service";

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

const extractExecStart = (unit: string): string => {
  const execStart = unit
    .split("\n")
    .find((line) => line.startsWith("ExecStart="));
  expect(execStart).toBeDefined();
  return execStart ?? "";
};

test("noVNC packages are provisioned by the desktop playbook", () => {
  const playbook = readFileSync("ansible/playbooks/0_desktop.yml", "utf-8");
  const taskIndex = playbook.indexOf(
    "Install noVNC packages (browser VNC client for the sign-in display :11)",
  );
  expect(taskIndex).toBeGreaterThanOrEqual(0);

  const taskBlock = playbook.slice(
    taskIndex,
    playbook.indexOf("- name:", taskIndex + 1),
  );
  expect(taskBlock).toContain("novnc");
  expect(taskBlock).toContain("websockify");
});

test("the sign-in display is a dedicated :11 Xvfb, not the streaming display :10", () => {
  const unit = extractUnitContent(
    "ansible/playbooks/0_desktop.yml",
    LOGIN_XVFB_UNIT_DEST,
  );

  expect(unit).toContain("ExecStart=/usr/bin/Xvfb :11");
  expect(unit).toContain("1280x1024x24");
  expect(unit).toContain("PartOf=makamujo-novnc.service");
  expect(unit).not.toContain(":10");
  expect(unit).not.toContain("makamujo-xvfb.service");
  expect(unit).not.toContain("makamujo-x11vnc.service");
});

test("x11vnc shares the sign-in display on its own loopback port 5901", () => {
  const unit = extractUnitContent(
    "ansible/playbooks/0_desktop.yml",
    LOGIN_X11VNC_UNIT_DEST,
  );

  expect(unit).toContain("ExecStart=/usr/bin/x11vnc");
  expect(unit).toContain("-display :11");
  expect(unit).toContain("-rfbport 5901");
  expect(unit).toContain("-localhost");
  expect(unit).not.toContain("0.0.0.0");
  expect(unit).not.toContain(":10");
  expect(unit).toContain("Requires=makamujo-login-xvfb.service");
  expect(unit).toContain("PartOf=makamujo-novnc.service");
  // Without this, stopping the display reports "failed" every run.
  expect(unit).toContain("SuccessExitStatus=");
});

test("makamujo noVNC unit bridges the loopback sign-in endpoint over websockify", () => {
  const unit = extractUnitContent(
    "ansible/playbooks/0_desktop.yml",
    NOVNC_UNIT_DEST,
  );

  expect(unit).toContain("ExecStart=/usr/bin/websockify");
  expect(unit).toContain("--web /usr/share/novnc");
  expect(unit).toContain("127.0.0.1:6080 127.0.0.1:5901");
  expect(unit).toContain("Requires=makamujo-login-x11vnc.service");
  expect(unit).toContain("After=makamujo-login-x11vnc.service");
  expect(unit).toContain("Restart=on-failure");
  expect(unit).toContain("WantedBy=multi-user.target");
});

test("noVNC never reaches the streaming display, so OBS and the game stay private", () => {
  const novnc = extractUnitContent(
    "ansible/playbooks/0_desktop.yml",
    NOVNC_UNIT_DEST,
  );
  const loginX11vnc = extractUnitContent(
    "ansible/playbooks/0_desktop.yml",
    LOGIN_X11VNC_UNIT_DEST,
  );

  for (const unit of [novnc, loginX11vnc]) {
    expect(unit).not.toContain("makamujo-xvfb.service");
    expect(unit).not.toContain("makamujo-x11vnc.service");
    expect(unit).not.toContain(":10");
    expect(unit).not.toContain("5900");
  }
});

test("noVNC stays bound to loopback because the sign-in display has no password", () => {
  const unit = extractUnitContent(
    "ansible/playbooks/0_desktop.yml",
    NOVNC_UNIT_DEST,
  );
  const execStart = extractExecStart(unit);

  expect(execStart).not.toContain("0.0.0.0");
  expect(execStart).not.toContain("::");
  expect(execStart).not.toMatch(/--?listen|:[0-9]+\s+localhost/);
});

test("noVNC and the sign-in display are installed but never enabled at boot", () => {
  const desktop = readFileSync("ansible/playbooks/0_desktop.yml", "utf-8");
  const taskIndex = desktop.indexOf(
    "Install makamujo noVNC unit (on-demand, started by bin/x/reserve.ts only)",
  );
  expect(taskIndex).toBeGreaterThanOrEqual(0);

  const taskEnd = desktop.indexOf("- name:", taskIndex + 1);
  const unitTask = desktop.slice(taskIndex, taskEnd);
  expect(unitTask).toContain(`dest: ${NOVNC_UNIT_DEST}`);

  const desktopTasks = [...desktop.matchAll(/^ {4}- name: (.+)$/gm)].map(
    (match) => match[1] ?? "",
  );
  for (const service of [
    "makamujo-novnc",
    "makamujo-login-xvfb",
    "makamujo-login-x11vnc",
  ]) {
    expect(desktopTasks.filter((name) => name.includes(service)).length).toBe(
      0,
    );
    expect([
      ...desktop.matchAll(new RegExp(`name: (${service})`, "g")),
    ]).toHaveLength(0);
  }
});

test("the deploy playbook leaves the sign-in stack alone so CD cannot keep it running", () => {
  const deploy = readFileSync("ansible/playbooks/2_makamujo.yml", "utf-8");
  const infraIndex = deploy.indexOf("Restart streaming infra");
  expect(infraIndex).toBeGreaterThanOrEqual(0);

  const infraBlock = deploy.slice(
    infraIndex,
    deploy.indexOf("wait_for", infraIndex),
  );
  expect(infraBlock).toContain("makamujo-x11vnc.service");
  for (const unit of [
    "makamujo-novnc.service",
    "makamujo-login-xvfb.service",
    "makamujo-login-x11vnc.service",
  ]) {
    expect(infraBlock).not.toContain(unit);
    expect(deploy).not.toContain(unit);
  }
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

test("reserve.ts points Chromium at the sign-in display and starts it before launch", () => {
  const reserve = readFileSync("bin/x/reserve.ts", "utf-8");

  expect(reserve).toContain("setLoginDisplay(headless)");
  const displayIndex = reserve.indexOf("setLoginDisplay(headless)");
  const startIndex = reserve.indexOf("await startNoVnc();");
  const launchIndex = reserve.indexOf("await launchPersistentContext(");

  // The X display must exist before Chromium connects to it.
  expect(displayIndex).toBeLessThan(launchIndex);
  expect(startIndex).toBeLessThan(launchIndex);
  expect(reserve).not.toContain("login: true");
});

test("reserve.ts opens the sign-in page, otherwise nobody can sign in", () => {
  const reserve = readFileSync("bin/x/reserve.ts", "utf-8");

  // The wait polls cookies, so the browser has to actually be on a page that
  // redirects to the Niconico sign-in form.
  const signInBranch = reserve.slice(
    reserve.indexOf("if (!hasNiconicoSession(await readCookies()))"),
    reserve.indexOf("} do {"),
  );
  const gotoIndex = signInBranch.indexOf("page.goto(");
  const waitIndex = signInBranch.indexOf("waitForNiconicoSession");
  expect(gotoIndex).toBeGreaterThanOrEqual(0);
  expect(gotoIndex).toBeLessThan(waitIndex);
});

test("reserve.ts falls back to a visible browser when -y cannot show a sign-in form", () => {
  const reserve = readFileSync("bin/x/reserve.ts", "utf-8");

  const signInBranch = reserve.slice(
    reserve.indexOf("if (!hasNiconicoSession(await readCookies()))"),
    reserve.indexOf("} do {"),
  );
  expect(signInBranch).toContain("if (headless) {");
  expect(signInBranch).toContain("setLoginDisplay(false)");
  expect(signInBranch).toContain("headless: false");
  // The relaunched context has to be the one the later steps use.
  expect(signInBranch).toContain("page = ctx.pages()[0]");
});

test("reserve.ts stops the sign-in display on SIGINT/SIGTERM, not just on exit", () => {
  const reserve = readFileSync("bin/x/reserve.ts", "utf-8");

  // `process.on("exit")` does not fire for signals, which would leave the
  // unauthenticated sign-in display reachable after an interrupted run.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    expect(reserve).toContain(`"${signal}"`);
  }
  expect(reserve).toContain("void stopNoVnc().finally(() => process.exit(0));");
});

test("reserve.ts waits for a human sign-in before touching Niconico", () => {
  const reserve = readFileSync("bin/x/reserve.ts", "utf-8");

  expect(reserve).toContain("hasNiconicoSession(await readCookies())");
  expect(reserve).toContain("waitForNiconicoSession(readCookies, {");

  const signInIndex = reserve.indexOf("waitForNiconicoSession");
  const firstPageUse = reserve.indexOf("garage.nicovideo.jp");
  expect(signInIndex).toBeLessThan(firstPageUse);
});

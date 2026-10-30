import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const PLAYBOOK = "ansible/playbooks/0_desktop.yml";
const XVFB_UNIT_DEST = "/etc/systemd/system/makamujo-xvfb.service";

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

test("the streaming display is a 2560x1440 Xvfb on :10", () => {
  const unit = extractUnitContent(PLAYBOOK, XVFB_UNIT_DEST);
  expect(unit).toContain("ExecStart=/usr/bin/Xvfb :10");
  expect(unit).toContain("2560x1440x24");
});

test("OBS output stays at 1280x720", () => {
  const ini = readFileSync(
    "obs-studio/basic/profiles/Makamujo/basic.ini",
    "utf-8",
  );
  expect(ini).toContain("BaseCX=1280");
  expect(ini).toContain("BaseCY=720");
  expect(ini).toContain("OutputCX=1280");
  expect(ini).toContain("OutputCY=720");
});

test("OBS streams at 30 FPS (>= 24 FPS target)", () => {
  const ini = readFileSync(
    "obs-studio/basic/profiles/Makamujo/basic.ini",
    "utf-8",
  );
  expect(ini).toContain("FPSCommon=30");
});

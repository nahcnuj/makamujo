import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const STREAMING_XVFB_UNIT_DEST = "/etc/systemd/system/makamujo-xvfb.service";

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

test("the streaming display keeps its 16:9 2560x1440 canvas", () => {
  const unit = extractUnitContent(
    "ansible/playbooks/0_desktop.yml",
    STREAMING_XVFB_UNIT_DEST,
  );

  expect(unit).toContain("ExecStart=/usr/bin/Xvfb :10");
  expect(unit).toContain("2560x1440x24");
  expect(unit).not.toContain("2560x1080");
});

test("OBS keeps its 1280x720 output resolution", () => {
  const ini = readFileSync(
    "obs-studio/basic/profiles/Makamujo/basic.ini",
    "utf-8",
  );

  expect(ini).toMatch(/^BaseCX=1280$/m);
  expect(ini).toMatch(/^BaseCY=720$/m);
  expect(ini).toMatch(/^OutputCX=1280$/m);
  expect(ini).toMatch(/^OutputCY=720$/m);
});

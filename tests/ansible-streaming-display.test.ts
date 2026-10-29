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

test("the streaming display keeps the 2560x1440 Xvfb canvas", () => {
  const unit = extractUnitContent(
    "ansible/playbooks/0_desktop.yml",
    STREAMING_XVFB_UNIT_DEST,
  );

  expect(unit).toContain("ExecStart=/usr/bin/Xvfb :10");
  expect(unit).toContain("2560x1440x24");
  expect(unit).not.toContain("1280x720");
});

test("OBS keeps the 1280x720 output resolution", () => {
  const ini = readFileSync(
    "obs-studio/basic/profiles/Makamujo/basic.ini",
    "utf-8",
  );

  expect(ini).toContain("BaseCX=1280");
  expect(ini).toContain("BaseCY=720");
  expect(ini).toContain("OutputCX=1280");
  expect(ini).toContain("OutputCY=720");
});

test("the overlay browser stays at the 1280x720 OBS crop geometry", () => {
  const overlay = readFileSync("bin/x/overlay.ts", "utf-8");

  expect(overlay).toContain("viewport: { width: 1280, height: 720 }");
  expect(overlay).toContain("--window-size=1280,720");
  expect(overlay).toContain("--window-position=0,40");
});

test("the game browser stays at the 1280x720 crop at (1280, 40)", () => {
  const chromium = readFileSync("lib/Browser/chromium.ts", "utf-8");

  expect(chromium).toContain("--window-position=1280,40");
  expect(chromium).toContain("width: 1280,");
  expect(chromium).toContain("height: 720,");
});

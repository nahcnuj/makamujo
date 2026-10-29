import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("the streaming display keeps its 16:9 2560x1440 canvas", () => {
  const playbook = readFileSync("ansible/playbooks/0_desktop.yml", "utf-8");
  expect(playbook).toContain("2560x1440x24");
  expect(playbook).not.toContain("2560x1080x24");
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

test("the game session viewport matches the 1280x720 crop", () => {
  const session = readFileSync("bin/x/browser.session.ts", "utf-8");
  expect(session).toContain("width: 1280");
  expect(session).toContain("height: 720");
});

test("the overlay browser matches the 1280x720 crop", () => {
  const overlay = readFileSync("bin/x/overlay.ts", "utf-8");
  expect(overlay).toContain("width: 1280, height: 720");
  expect(overlay).toContain("--window-size=1280,720");
  expect(overlay).toContain("--window-position=0,40");
});

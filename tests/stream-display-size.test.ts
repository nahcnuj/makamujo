import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("the streaming Xvfb display keeps its 2560x1440 canvas", () => {
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

test("the OBS display capture crops the 2560x1440 canvas into the 1280x720 game panel", () => {
  const scene = JSON.parse(
    readFileSync("obs-studio/basic/scenes/Makamujo.json", "utf-8"),
  ) as {
    sources: Array<{
      name: string;
      settings?: { cut_left?: number; cut_top?: number; cut_bot?: number };
    }>;
  };
  const capture = scene.sources.find(
    (source) => source.name === "Display Capture (XSHM)",
  );
  expect(capture?.settings?.cut_left).toBe(1280);
  expect(capture?.settings?.cut_top).toBe(40);
  expect(capture?.settings?.cut_bot).toBe(680);
});

test("the overlay browser keeps its 1280x720 viewport", () => {
  const overlay = readFileSync("bin/x/overlay.ts", "utf-8");
  expect(overlay).toContain("viewport: { width: 1280, height: 720 }");
  expect(overlay).toContain("--window-size=1280,720");
  expect(overlay).toContain("--window-position=0,40");
});

test("the game browser session keeps its 1280x720 viewport", () => {
  const session = readFileSync("bin/x/browser.session.ts", "utf-8");
  expect(session).toContain("width: 1280,");
  expect(session).toContain(
    "height: 720, // match stream crop; scale via page zoom",
  );
});

test("the shared Chromium launcher defaults to the 1280x720 game viewport", () => {
  const chromium = readFileSync("lib/Browser/chromium.ts", "utf-8");
  expect(chromium).toContain("width: 1280,");
  expect(chromium).toContain("height: 720,");
  expect(chromium).toContain("--window-position=1280,40");
});

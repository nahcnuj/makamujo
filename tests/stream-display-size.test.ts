import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("overlay browser is 1280x720 at (0,40)", () => {
  const overlay = readFileSync("bin/x/overlay.ts", "utf-8");
  expect(overlay).toContain("viewport: { width: 1280, height: 720 }");
  expect(overlay).toContain("--window-size=1280,720");
  expect(overlay).toContain("--window-position=0,40");
});

test("game browser is 1280x720", () => {
  const session = readFileSync("bin/x/browser.session.ts", "utf-8");
  expect(session).toContain("width: 1280");
  expect(session).toContain("height: 720");
});

test("streaming canvas is 2560x1440", () => {
  const playbook = readFileSync("ansible/playbooks/0_desktop.yml", "utf-8");
  expect(playbook).toContain("2560x1440");
});

test("OBS preview backdrop is 1280x720", () => {
  const vrt = readFileSync(
    "tests/vrt/stream/visual-regression.test.ts",
    "utf-8",
  );
  expect(vrt).toContain("width:1280px;height:720px");
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("the streaming display premise keeps Xvfb at 2560x1440", () => {
  const playbook = readFileSync("ansible/playbooks/0_desktop.yml", "utf-8");

  expect(playbook).toContain("2560x1440x24");
  expect(playbook).toContain("Makamujo streaming display :10 (2560x1440)");
});

test("the OBS preview window keeps the 1280x720 overlay geometry", () => {
  const overlay = readFileSync("bin/x/overlay.ts", "utf-8");

  expect(overlay).toContain("viewport: { width: 1280, height: 720 }");
  expect(overlay).toContain("--window-size=1280,720");
  expect(overlay).toContain("--window-position=0,40");
});

test("the game session keeps the 1280x720 viewport", () => {
  const session = readFileSync("bin/x/browser.session.ts", "utf-8");

  expect(session).toContain("width: 1280,");
  expect(session).toContain(
    "height: 720, // match stream crop; scale via page zoom",
  );
});

test("the VRT harness renders the OBS preview at 1280x720", () => {
  const vrt = readFileSync(
    "tests/vrt/stream/visual-regression.test.ts",
    "utf-8",
  );

  expect(vrt).toContain("await renderBroadcastScreen(page, 1280, 720)");
  expect(vrt).toContain("stream-overlay-1280x720.png");
});

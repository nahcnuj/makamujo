import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("Dockerfile reproduces the VPS browser runtime prerequisites", () => {
  for (const path of ["Dockerfile", "docker/Dockerfile", "Dockerfile.vps"]) {
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("FROM debian:13");
    expect(content).toContain("xvfb");
    expect(content).toContain("DISPLAY=:99");
    expect(content).toContain("PLAYWRIGHT_BROWSERS_PATH=/ms-playwright");
    expect(content).toContain("XDG_RUNTIME_DIR=/run/user/0");
    expect(content).toContain("PULSE_SERVER=unix:/run/user/0/pulse/native");
    expect(content).toContain("PULSE_RUNTIME_PATH=/run/user/0/pulse");
    expect(content).toContain("Xvfb :99 -screen 0 1280x720x24");
  }
});

test("Docker ansible playbook installs Playwright and provisions audio/display services", () => {
  const content = readFileSync("ansible/playbooks/docker.yml", "utf-8");
  expect(content).toContain("bunx playwright install chromium");
  expect(content).toContain("bunx playwright install-deps chromium");
  expect(content).toContain("DISPLAY: :99");
  expect(content).toContain("makamujo-pipewire.service");
  expect(content).toContain("makamujo-screen.service");
  expect(content).toContain("makamujo-browser.service");
  expect(content).toContain("makamujo-obs.service");
  expect(content).toContain("DISPLAY=:99");
  expect(content).toContain("makamujo-pipewire");
});

test("Playwright config enables root-safe Chromium launch flags", () => {
  const content = readFileSync("playwright.config.ts", "utf-8");
  expect(content).toContain("--no-sandbox");
  expect(content).toContain("--disable-dev-shm-usage");
  expect(content).toContain("--disable-gpu");
  expect(content).toContain("--disable-software-rasterizer");
});

test("PipeWire startup script honors the DISPLAY environment", () => {
  const content = readFileSync("bin/makamujo-pipewire", "utf-8");
  const needle = "export DISPLAY=" + '"';
  const tail = "$" + "{DISPLAY:-:10}" + '"';
  expect(content).toContain(needle + tail);
});

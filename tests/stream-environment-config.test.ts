import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type Ini = Map<string, Map<string, string>>;

function parseIni(path: string): Ini {
  const ini: Ini = new Map();
  let section = "";

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith(";") || trimmed.startsWith("#")) {
      continue;
    }

    const sectionMatch = /^\[(.+)\]$/.exec(trimmed);
    if (sectionMatch !== null) {
      section = sectionMatch[1] ?? "";
      if (!ini.has(section)) ini.set(section, new Map());
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (section === "" || separator < 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    let target = ini.get(section);
    if (target === undefined) {
      target = new Map();
      ini.set(section, target);
    }
    target.set(key, value);
  }

  return ini;
}

function parseSystemdSize(value: string | undefined): number {
  const match = /^(\d+(?:\.\d+)?)([KMGT]?)$/i.exec(value ?? "");
  if (match === null) {
    throw new Error(`Unsupported systemd size: ${value ?? "<missing>"}`);
  }

  const amount = Number(match[1]);
  const suffix = (match[2] ?? "").toUpperCase();
  const factor =
    suffix === "K"
      ? 1024
      : suffix === "M"
        ? 1024 ** 2
        : suffix === "G"
          ? 1024 ** 3
          : suffix === "T"
            ? 1024 ** 4
            : 1;
  return amount * factor;
}

function readServiceValue(content: string, key: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) {
      return trimmed.slice(key.length + 1).trim();
    }
  }
  return undefined;
}

describe("OBS encoding load", () => {
  test("keeps the lightest x264 preset for stable 30 fps encoding", () => {
    const profile = parseIni("obs-studio/basic/profiles/Makamujo/basic.ini");
    const output = profile.get("SimpleOutput");

    expect(output?.get("Preset")).toBe("ultrafast");
    expect(output?.get("StreamEncoder")).toBe("x264");
  });

  test("streams at 30 fps so an isolated dropped frame stays above 24 fps", () => {
    const profile = parseIni("obs-studio/basic/profiles/Makamujo/basic.ini");
    const video = profile.get("Video");

    expect(Number(video?.get("FPSCommon"))).toBeGreaterThanOrEqual(24);
    expect(video?.get("FPSCommon")).toBe("30");
    expect(video?.get("OutputCX")).toBe("1280");
    expect(video?.get("OutputCY")).toBe("720");
  });

  test("does not spend CPU rendering a software preview nobody watches", () => {
    const user = parseIni("obs-studio/user.ini");
    expect(user.get("BasicWindow")?.get("PreviewEnabled")).toBe("false");
  });

  test("lets the browser source produce every output frame", () => {
    const scene = JSON.parse(
      readFileSync("obs-studio/basic/scenes/Makamujo.json", "utf8"),
    ) as {
      sources?: Array<{ id?: string; settings?: { fps?: number } }>;
    };
    const browserSource = scene.sources?.find(
      (source) => source.id === "browser_source",
    );

    expect(browserSource).toBeDefined();
    expect(browserSource?.settings?.fps).toBeGreaterThanOrEqual(30);
  });
});

describe("OBS resource budget", () => {
  const service = readFileSync("etc/systemd/makamujo-obs.service", "utf8");

  test("does not throttle OBS with a memory limit below its working set", () => {
    const memoryHigh = parseSystemdSize(
      readServiceValue(service, "MemoryHigh"),
    );
    const memoryMax = parseSystemdSize(readServiceValue(service, "MemoryMax"));

    expect(memoryHigh).toBeGreaterThanOrEqual(512 * 1024 ** 2);
    expect(memoryMax).toBeGreaterThanOrEqual(1024 * 1024 ** 2);
    expect(memoryMax).toBeGreaterThanOrEqual(memoryHigh);
  });

  test("gives OBS enough CPU to encode and compose without starvation", () => {
    const quota = readServiceValue(service, "CPUQuota");
    const weight = Number(readServiceValue(service, "CPUWeight"));
    const nice = Number(readServiceValue(service, "Nice"));

    expect(Number.parseInt(quota ?? "", 10)).toBeGreaterThanOrEqual(300);
    expect(weight).toBeGreaterThanOrEqual(500);
    expect(nice).toBeLessThanOrEqual(0);
  });
});

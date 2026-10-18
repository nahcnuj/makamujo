import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  GAME_CLIP,
  GAME_MIN_FPS,
  VIDEO_MIN_FPS,
} from "../scripts/check-stream.ts";

const SCENE_PATH = "obs-studio/basic/scenes/Makamujo.json";
const PROFILE_INI_PATH = "obs-studio/basic/profiles/Makamujo/basic.ini";

const MARQUEE_SOURCE_NAME = "marquee";
const MARQUEE_PATTERN = "░▒▓█";
const SHADE_LEVEL_STEP = 0.25;
const ABGR_ALPHA_OPAQUE = 0xff;

const CHECKER_SAMPLE_LONG_EDGE = 128;
const CHECKER_PIXEL_CHANNEL_TOLERANCE = 16;
const MIN_SAMPLED_SHIFT_PER_OUTPUT_FRAME = 1;

const GLYPH_WIDTH_RATIOS = [0.5, 1] as const;

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const asArray = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
};

const asString = (value: unknown, label: string): string => {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
};

const asNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
};

const asBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
};

const readIniValue = (ini: string, key: string, path: string): string => {
  const line = ini
    .split("\n")
    .find((candidate) => candidate.startsWith(`${key}=`));
  if (!line) {
    throw new Error(`${key} is missing from ${path}`);
  }
  return line.slice(key.length + 1);
};

test("the program scene renders a full-width marquee band that never stops moving", () => {
  const scene = JSON.parse(readFileSync(SCENE_PATH, "utf-8")) as Record<
    string,
    unknown
  >;
  const programSceneName = asString(
    scene.current_program_scene,
    "current_program_scene",
  );

  const sources = asArray(scene.sources, "sources").map((source, index) =>
    asRecord(source, `sources[${index}]`),
  );
  const programScene = sources.find(
    (source) => source.id === "scene" && source.name === programSceneName,
  );
  expect(programScene, `${programSceneName} scene must exist`).toBeDefined();

  const items = asArray(
    asRecord(programScene?.settings, "program scene settings").items,
    "program scene items",
  ).map((item, index) => asRecord(item, `program scene items[${index}]`));
  const marqueeItemIndex = items.findIndex(
    (item) => item.name === MARQUEE_SOURCE_NAME,
  );
  expect(marqueeItemIndex).toBeGreaterThanOrEqual(0);
  const marqueeItem = items[marqueeItemIndex];

  expect(marqueeItem).toBeDefined();
  expect(
    asBoolean(marqueeItem?.visible, "marquee item visible"),
    "the band must be shown in the program scene",
  ).toBe(true);

  const visibleItemsAboveMarquee = items
    .slice(marqueeItemIndex + 1)
    .filter((item) => asBoolean(item.visible, "scene item visible"));
  expect(
    visibleItemsAboveMarquee,
    "nothing may cover the band in the program scene",
  ).toEqual([]);

  const marqueeSourceUuid = asString(
    marqueeItem?.source_uuid,
    "marquee source_uuid",
  );
  const marqueeSource = sources.find(
    (source) => source.uuid === marqueeSourceUuid,
  );
  expect(marqueeSource).toBeDefined();
  expect(marqueeSource?.id).toBe("text_ft2_source");
  expect(asBoolean(marqueeSource?.enabled, "marquee source enabled")).toBe(
    true,
  );

  const sourceSettings = asRecord(
    marqueeSource?.settings,
    "marquee source settings",
  );
  const text = asString(sourceSettings.text, "marquee text");
  expect(text.length).toBeGreaterThan(0);
  expect(text.length % MARQUEE_PATTERN.length).toBe(0);
  expect(text).toBe(
    MARQUEE_PATTERN.repeat(text.length / MARQUEE_PATTERN.length),
  );

  for (const [label, color] of [
    ["color1", sourceSettings.color1],
    ["color2", sourceSettings.color2],
  ] as const) {
    const channelValue = asNumber(color, label);
    expect(channelValue >>> 24).toBe(ABGR_ALPHA_OPAQUE);
    const red = channelValue & 0xff;
    const green = (channelValue >> 8) & 0xff;
    const blue = (channelValue >> 16) & 0xff;
    const brightestChannel = Math.max(red, green, blue);
    expect(
      brightestChannel * SHADE_LEVEL_STEP,
      `${label} keeps adjacent shade levels above the checker tolerance`,
    ).toBeGreaterThan(CHECKER_PIXEL_CHANNEL_TOLERANCE);
  }

  const scrollFilter = asArray(marqueeSource?.filters, "marquee filters").find(
    (filter) => asRecord(filter, "marquee filter").id === "scroll_filter",
  );
  expect(scrollFilter, "scroll filter must exist").toBeDefined();
  const scrollFilterRecord = asRecord(scrollFilter, "scroll filter");
  expect(asBoolean(scrollFilterRecord.enabled, "scroll filter enabled")).toBe(
    true,
  );
  const scrollFilterSettings = asRecord(
    scrollFilterRecord.settings,
    "scroll settings",
  );
  expect(
    asBoolean(scrollFilterSettings.loop, "scroll loop"),
    "scrolling must wrap instead of clamping at the end",
  ).toBe(true);
  expect(asBoolean(scrollFilterSettings.limit_cx, "scroll limit_cx")).toBe(
    true,
  );
  const scrollWidth = asNumber(scrollFilterSettings.cx, "scroll cx");
  const scrollSpeedX = asNumber(scrollFilterSettings.speed_x, "scroll speed_x");
  expect(scrollSpeedX).toBeGreaterThan(0);

  const profileIni = readFileSync(PROFILE_INI_PATH, "utf-8");
  const canvasWidth = Number.parseInt(
    readIniValue(profileIni, "BaseCX", PROFILE_INI_PATH),
    10,
  );
  const canvasHeight = Number.parseInt(
    readIniValue(profileIni, "BaseCY", PROFILE_INI_PATH),
    10,
  );
  const outputFps = Number.parseInt(
    readIniValue(profileIni, "FPSCommon", PROFILE_INI_PATH),
    10,
  );
  expect(canvasWidth > 0).toBe(true);
  expect(canvasHeight > 0).toBe(true);
  expect(
    outputFps > VIDEO_MIN_FPS,
    "the output must be able to outpace the checker's whole-video floor",
  ).toBe(true);
  expect(GAME_MIN_FPS).toBeLessThan(VIDEO_MIN_FPS);

  const scale = asRecord(marqueeItem?.scale, "marquee scale");
  const scaleX = asNumber(scale.x, "marquee scale.x");
  const position = asRecord(marqueeItem?.pos, "marquee pos");
  const bandLeft = asNumber(position.x, "marquee pos.x");
  const bandTop = asNumber(position.y, "marquee pos.y");
  const bandRight = bandLeft + scrollWidth * scaleX;

  expect(
    bandLeft <= 0 && bandRight >= canvasWidth,
    "the band must span the whole canvas width",
  ).toBe(true);
  const gameRegionRight = canvasWidth * GAME_CLIP.widthRatio;
  expect(bandRight - bandLeft).toBeGreaterThanOrEqual(gameRegionRight);
  expect(bandTop).toBeGreaterThanOrEqual(canvasHeight / 2);
  expect(bandTop).toBeLessThan(canvasHeight);

  const sampleDownscale =
    Math.max(canvasWidth, canvasHeight) / CHECKER_SAMPLE_LONG_EDGE;
  const minScrollSpeed =
    outputFps * sampleDownscale * MIN_SAMPLED_SHIFT_PER_OUTPUT_FRAME;
  expect(
    scrollSpeedX,
    `scroll speed must shift at least one sampled pixel per output frame (min ${minScrollSpeed})`,
  ).toBeGreaterThanOrEqual(minScrollSpeed);

  const font = asRecord(sourceSettings.font, "marquee font");
  const fontSize = asNumber(font.size, "font.size");
  for (const glyphWidthRatio of GLYPH_WIDTH_RATIOS) {
    const glyphWidth = fontSize * glyphWidthRatio;
    const patternWidth = glyphWidth * MARQUEE_PATTERN.length;
    const textureWidth = glyphWidth * text.length;
    expect(
      textureWidth % patternWidth,
      "the texture must repeat whole pattern periods so the wrap seam is invisible",
    ).toBe(0);
    expect(textureWidth).toBeGreaterThanOrEqual(patternWidth);
  }
});

import { describe, expect, it } from "bun:test";
import { resolveOpenJTalkAssets } from "./openJTalkAssets";

describe("resolveOpenJTalkAssets", () => {
  it("uses configured environment paths when they exist", () => {
    const voicePath = "/tmp/custom-voice.htsvoice";
    const dictionaryPath = "/tmp/custom-dic";
    const existingPaths = new Set([voicePath, dictionaryPath]);
    const exists = (path: string) => existingPaths.has(path);

    const resolved = resolveOpenJTalkAssets({
      htsvoiceFile: voicePath,
      dictionaryDir: dictionaryPath,
    }, exists);

    expect(resolved.isConfigured).toBe(true);
    expect(resolved.htsvoiceFile).toBe(voicePath);
    expect(resolved.dictionaryDir).toBe(dictionaryPath);
  });

  it("uses expanded default locations when env vars are not provided", () => {
    const existingPaths = new Set([
      "/usr/share/hts-voice/mei/mei_normal.htsvoice",
      "/var/lib/mecab/dic/open-jtalk/naist-jdic",
    ]);
    const exists = (path: string) => existingPaths.has(path);

    const resolved = resolveOpenJTalkAssets({}, exists);

    expect(resolved.isConfigured).toBe(true);
    expect(resolved.htsvoiceFile).toBe("/usr/share/hts-voice/mei/mei_normal.htsvoice");
    expect(resolved.dictionaryDir).toBe("/var/lib/mecab/dic/open-jtalk/naist-jdic");
    expect(resolved.checkedHtsvoiceFiles).toContain("/usr/share/hts-voice/nitech-jp-atr503-m001/nitech_jp_atr503_m001.htsvoice");
    expect(resolved.checkedDictionaryDirs).toContain("/usr/share/open_jtalk_dic");
  });

  it("fails to configure when explicit env paths are missing", () => {
    const existingPaths = new Set([
      "/usr/share/hts-voice/mei/mei_normal.htsvoice",
      "/var/lib/mecab/dic/open-jtalk/naist-jdic",
    ]);
    const exists = (path: string) => existingPaths.has(path);

    const resolved = resolveOpenJTalkAssets({
      htsvoiceFile: "/custom/missing.htsvoice",
      dictionaryDir: "/custom/missing-dic",
    }, exists);

    expect(resolved.isConfigured).toBe(false);
    expect(resolved.checkedHtsvoiceFiles).toEqual(["/custom/missing.htsvoice"]);
    expect(resolved.checkedDictionaryDirs).toEqual(["/custom/missing-dic"]);
  });
});

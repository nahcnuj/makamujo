import { existsSync } from "node:fs";

const OPEN_JTALK_HTSVOICE_DEFAULTS = [
  "/usr/share/hts-voice/nitech-jp-atr503-m001/nitech_jp_atr503_m001.htsvoice",
  "/usr/share/hts-voice/mei/mei_normal.htsvoice",
] as const;

const OPEN_JTALK_DICTIONARY_DEFAULTS = [
  "/var/lib/mecab/dic/open-jtalk",
  "/var/lib/mecab/dic/open-jtalk/naist-jdic",
  "/usr/share/open_jtalk_dic",
  "/usr/share/open_jtalk_dic_utf_8",
] as const;

export type OpenJTalkAssetResolution = {
  htsvoiceFile: string
  dictionaryDir: string
  isConfigured: boolean
  checkedHtsvoiceFiles: string[]
  checkedDictionaryDirs: string[]
};

const uniq = (paths: string[]) => [...new Set(paths)];

const resolveFromCandidates = (candidates: string[], exists: (path: string) => boolean) => {
  const checkedCandidates = uniq(candidates);
  const resolved = checkedCandidates.find((candidate) => exists(candidate));
  return {
    checkedCandidates,
    resolved: resolved ?? checkedCandidates[0] ?? "",
    exists: resolved !== undefined,
  };
};

export const resolveOpenJTalkAssets = (
  {
    htsvoiceFile,
    dictionaryDir,
  }: {
    htsvoiceFile?: string
    dictionaryDir?: string
  } = {},
  exists: (path: string) => boolean = existsSync,
): OpenJTalkAssetResolution => {
  const htsvoiceCandidates = htsvoiceFile ? [htsvoiceFile] : [...OPEN_JTALK_HTSVOICE_DEFAULTS];
  const dictionaryCandidates = dictionaryDir ? [dictionaryDir] : [...OPEN_JTALK_DICTIONARY_DEFAULTS];

  const htsvoiceResult = resolveFromCandidates(htsvoiceCandidates, exists);
  const dictionaryResult = resolveFromCandidates(dictionaryCandidates, exists);

  return {
    htsvoiceFile: htsvoiceResult.resolved,
    dictionaryDir: dictionaryResult.resolved,
    isConfigured: htsvoiceResult.exists && dictionaryResult.exists,
    checkedHtsvoiceFiles: htsvoiceResult.checkedCandidates,
    checkedDictionaryDirs: dictionaryResult.checkedCandidates,
  };
};

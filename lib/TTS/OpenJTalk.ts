import { execFileSync } from "node:child_process";

/**
 * @see {@link https://kledgeb.blogspot.com/2014/05/ubuntu-open-jtalk-2-openjtalk.html}
 */
export type OpenJTalkOptions = {
  /** `-m` */
  htsvoiceFile: string
  /** `-x` */
  dictionaryDir: string
  /** `-fm` */
  additionalHalfTone?: number
  /** `-r` */
  speakingRate?: number
};

/**
 * 
 * @param input text to speech
 * @param path a file path where output result. `-ow`
 * @param options {OpenJTalkOptions}
 */
export const generateWavFile = (input: string, path: `${string}.wav`, {
  htsvoiceFile,
  dictionaryDir,
  additionalHalfTone = 0,
  speakingRate = 1,
}: OpenJTalkOptions) => {
  try {
    execFileSync('open_jtalk', [
      '-m', htsvoiceFile,
      '-x', dictionaryDir,
      '-fm', additionalHalfTone.toFixed(1),
      '-r', speakingRate.toFixed(1),
      '-ow', path,
    ], {
      input,
      encoding: 'utf-8',
    });
  } catch {
    // do nothing
  }
};

import { execFileSync } from "node:child_process";

export type OpenJTalkOptions = {
  /** `-m` */
  htsvoiceFile: string,
  /** `-x` */
  dictionaryDir: string,
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
}: OpenJTalkOptions) => {
  execFileSync('open_jtalk', [
    '-m', htsvoiceFile,
    '-x', dictionaryDir,
    '-ow', path,
  ], {
    input,
    encoding: 'utf-8',
  });
};

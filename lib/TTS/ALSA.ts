import { execFileSync } from "node:child_process";

export const play = (file: `${string}.wav`) => {
  try {
    execFileSync('aplay', [
      '-q',
      file,
    ]);
  } catch {
    // do nothing
  }
};

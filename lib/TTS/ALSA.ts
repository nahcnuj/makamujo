import { execFileSync } from "node:child_process";

export const play = (file: `${string}.wav`) => {
  execFileSync('aplay', [
    '-q',
    file,
  ]);
};

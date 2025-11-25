import { execFile as $_ } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify($_);

export const play = async (file: `${string}.wav`) => {
  try {
    await execFile('aplay', [
      '-q',
      file,
    ]);
  } catch {
    // do nothing
  }
};

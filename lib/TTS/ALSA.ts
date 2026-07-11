import { execFile as $_ } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify($_);

/**
 * Play a WAV via ALSA `aplay`. Rejects when aplay fails (device busy, missing, etc.).
 */
export const play = async (file: `${string}.wav`) => {
  await execFile("aplay", ["-q", file]);
};

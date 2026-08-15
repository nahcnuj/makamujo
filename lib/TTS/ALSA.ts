import { execFile as $_ } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify($_);

export const play = async (file: `${string}.wav`) => {
  // PipeWire (PULSE_SERVER) 優先
  try {
    await execFile("paplay", [file]);
    return;
  } catch {
    // fallback
  }

  // ALSA fallback
  try {
    await execFile("aplay", ["-q", file]);
  } catch {
    // silent
  }
};

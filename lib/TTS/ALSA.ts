import { execFile as $_ } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify($_);

const pulseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? "/run/user/0",
  PULSE_SERVER: process.env.PULSE_SERVER ?? "unix:/run/user/0/pulse/native",
  PULSE_RUNTIME_PATH: process.env.PULSE_RUNTIME_PATH ?? "/run/user/0/pulse",
};

export const play = async (file: `${string}.wav`) => {
  try {
    await execFile("paplay", [file], { env: pulseEnv });
    return;
  } catch (err) {
    console.error("[TTS] paplay failed:", err);
  }
  try {
    await execFile("aplay", ["-q", file], { env: pulseEnv });
  } catch (err) {
    console.error("[TTS] aplay failed:", err);
  }
};
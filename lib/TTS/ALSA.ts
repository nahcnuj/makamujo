import { execFile as $_ } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify($_);

const pulseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? "/run/user/0",
  PULSE_SERVER: process.env.PULSE_SERVER ?? "unix:/run/user/0/pulse/native",
  PULSE_RUNTIME_PATH: process.env.PULSE_RUNTIME_PATH ?? "/run/user/0/pulse",
};

export type PlaybackOutcome =
  | { played: true }
  | { played: false; reason: string };

type PlayerFailure = {
  code?: unknown;
  stderr?: unknown;
};

/**
 * Reduce a rejected `execFile` to the one line an operator needs.
 *
 * The raw error embeds a multi-line dump of Bun's `node:child_process` shim, so
 * a dead backend made every utterance log source excerpts of a file the reader
 * has no reason to open. The player's own stderr carries the actual cause
 * ("Connection refused"), so keep that and the exit code.
 */
export const describePlayerFailure = (err: unknown): string => {
  if (typeof err !== "object" || err === null) return String(err);
  const failure = err as PlayerFailure;
  const { stderr } = failure;
  const detail =
    typeof stderr === "string"
      ? stderr
      : stderr instanceof Uint8Array
        ? new TextDecoder().decode(stderr)
        : "";
  const firstLine = detail
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const exitCode =
    typeof failure.code === "number" ? `exit ${failure.code}` : undefined;
  if (firstLine === undefined) return exitCode ?? "unknown error";
  return exitCode === undefined ? firstLine : `${exitCode}: ${firstLine}`;
};

/**
 * Play a WAV through PulseAudio, falling back to ALSA. Reports whether anything
 * was actually audible so the caller can react; never rejects, because a dead
 * audio backend must not stall the speech queue.
 */
export const play = async (file: `${string}.wav`): Promise<PlaybackOutcome> => {
  try {
    await execFile("paplay", [file], { env: pulseEnv });
    return { played: true };
  } catch (err) {
    const reason = describePlayerFailure(err);
    console.error(`[TTS] paplay failed: ${reason}`);
    try {
      await execFile("aplay", ["-q", file], { env: pulseEnv });
      return { played: true };
    } catch (fallbackErr) {
      console.error(
        `[TTS] aplay failed: ${describePlayerFailure(fallbackErr)}`,
      );
      return { played: false, reason };
    }
  }
};

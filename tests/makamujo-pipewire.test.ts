import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const script = readFileSync("bin/makamujo-pipewire", "utf-8");

const indexOfLine = (needle: string): number => {
  const index = script.indexOf(needle);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
};

describe("makamujo-pipewire", () => {
  it("waits for stale audio processes to exit before unlinking the socket", () => {
    const waitIndex = indexOfLine("audio_process_alive || break");
    const forceKillIndex = indexOfLine("pkill -9 -u root -x wireplumber");
    const unlinkIndex = indexOfLine('rm -f "${PULSE_RUNTIME_PATH}/native"');

    expect(waitIndex).toBeGreaterThanOrEqual(0);
    expect(forceKillIndex).toBeGreaterThan(waitIndex);
    expect(unlinkIndex).toBeGreaterThan(forceKillIndex);
    expect(script).not.toContain("sleep 0.3");
  });

  it("checks every audio daemon when deciding whether one is still alive", () => {
    for (const daemon of ["wireplumber", "pipewire-pulse", "pipewire"]) {
      expect(script).toContain(`pgrep -u root -x ${daemon}`);
    }
  });

  it("starts wireplumber before loading the null sink and before signalling ready", () => {
    const wireplumberIndex = indexOfLine("wireplumber &\nWP_PID=$!");
    const nullSinkIndex = indexOfLine("pactl load-module module-null-sink");
    const readyIndex = indexOfLine("systemd-notify --ready");

    expect(nullSinkIndex).toBeGreaterThan(wireplumberIndex);
    expect(readyIndex).toBeGreaterThan(wireplumberIndex);
  });

  it("tolerates a transient pulse socket blip before failing the unit", () => {
    const missesIndex = indexOfLine("socket_misses=$((socket_misses + 1))");
    const thresholdIndex = indexOfLine('[ "$socket_misses" -ge 3 ]');
    const lostIndex = indexOfLine("ERROR: pulse socket lost");

    expect(thresholdIndex).toBeGreaterThan(missesIndex);
    expect(lostIndex).toBeGreaterThan(thresholdIndex);
    expect(script).toContain("socket_misses=0");
  });
});

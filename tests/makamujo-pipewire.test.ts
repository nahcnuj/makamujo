import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const script = readFileSync("bin/makamujo-pipewire", "utf-8");
const unit = readFileSync("etc/systemd/makamujo-pipewire.service", "utf-8");

const indexOfLine = (needle: string, from = 0): number => {
  const index = script.indexOf(needle, from);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
};

/** Returns the unit block the desktop playbook writes to /etc/systemd/system. */
const readDeployedUnit = (): string => {
  const lines = readFileSync("ansible/playbooks/0_desktop.yml", "utf-8").split(
    "\n",
  );
  const destIndex = lines.findIndex((line) =>
    line.includes("dest: /etc/systemd/system/makamujo-pipewire.service"),
  );
  expect(destIndex).toBeGreaterThanOrEqual(0);

  const contentIndex = lines.findIndex(
    (line, i) => i > destIndex && line.trim() === "content: |",
  );
  expect(contentIndex).toBeGreaterThanOrEqual(0);

  const firstLine = lines[contentIndex + 1] ?? "";
  const indent = firstLine.length - firstLine.trimStart().length;
  expect(indent).toBeGreaterThan(0);

  let deployed = "";
  for (let i = contentIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() !== "" && !line.startsWith(" ".repeat(indent))) break;
    deployed += `${line.slice(indent)}\n`;
  }
  return deployed;
};

/** Drops comments and blank lines so prose may differ between the two copies. */
const toDirectives = (contents: string): string[] =>
  contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

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
    // Assert the call site, not the definition: configure_pulse_defaults is
    // defined up front so both the startup and the repair path can use it.
    const nullSinkIndex = indexOfLine(
      "configure_pulse_defaults || {",
      wireplumberIndex,
    );
    const readyIndex = indexOfLine("systemd-notify --ready", wireplumberIndex);

    expect(nullSinkIndex).toBeGreaterThan(wireplumberIndex);
    expect(readyIndex).toBeGreaterThan(wireplumberIndex);
  });

  it("tolerates a transient pulse socket blip before touching the stack", () => {
    const missesIndex = indexOfLine("socket_misses=$((socket_misses + 1))");
    const thresholdIndex = indexOfLine(
      '[ "${socket_misses}" -ge "${PULSE_LOSS_TOLERANCE}" ]',
    );
    const resetIndex = indexOfLine("socket_misses=0");

    expect(thresholdIndex).toBeGreaterThan(missesIndex);
    expect(missesIndex).toBeGreaterThan(resetIndex);
    expect(script).toContain("PULSE_LOSS_TOLERANCE=3");
  });

  it("restarts pipewire-pulse in place instead of failing the unit", () => {
    const guardIndex = indexOfLine('process_alive "${PULSE_PID}" || {');
    const warnIndex = indexOfLine("restarting pipewire-pulse");
    const drainIndex = indexOfLine('wait_for_exit "${PULSE_PID}"');
    const restartIndex = indexOfLine(
      'start_pulse_server "${PULSE_SOCKET}" || {',
      drainIndex,
    );
    const readyIndex = indexOfLine("Pulse ready again", drainIndex);

    // The socket repair has to happen inside the watchdog, after the daemon
    // liveness checks, so a dead daemon is still reported as a daemon failure.
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(warnIndex).toBeGreaterThan(guardIndex);
    expect(drainIndex).toBeGreaterThan(warnIndex);
    expect(restartIndex).toBeGreaterThan(drainIndex);
    expect(readyIndex).toBeGreaterThan(restartIndex);
  });

  it("gives up after a bounded number of in-place pulse restarts", () => {
    const budgetIndex = indexOfLine(
      '[ "${pulse_restarts}" -ge "${MAX_PULSE_RESTARTS}" ]',
    );
    const fatalIndex = indexOfLine(
      "ERROR: pulse socket lost (${PULSE_SOCKET}): still missing",
    );

    expect(script).toContain("MAX_PULSE_RESTARTS=3");
    expect(fatalIndex).toBeGreaterThan(budgetIndex);
  });

  it("re-applies the pulse defaults whenever pipewire-pulse is replaced", () => {
    const configureIndex = indexOfLine("configure_pulse_defaults() {");
    const loadIndex = indexOfLine("pactl load-module module-null-sink");
    const defaultSinkIndex = indexOfLine("pactl set-default-sink makamujo_out");
    const defaultSourceIndex = indexOfLine(
      "pactl set-default-source makamujo_out.monitor",
    );

    expect(loadIndex).toBeGreaterThan(configureIndex);
    expect(defaultSinkIndex).toBeGreaterThan(loadIndex);
    expect(defaultSourceIndex).toBeGreaterThan(defaultSinkIndex);
  });
});

describe("makamujo-pipewire systemd unit", () => {
  it("bounds restart attempts so a broken stack settles instead of flapping", () => {
    const unitSection = unit.slice(0, unit.indexOf("[Service]"));

    expect(unitSection).toContain("StartLimitIntervalSec=300");
    expect(unitSection).toContain("StartLimitBurst=5");
    expect(unit).toContain("Restart=on-failure");
  });

  it("stays in sync with the copy the desktop playbook deploys", () => {
    expect(toDirectives(readDeployedUnit())).toEqual(toDirectives(unit));
  });
});

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const script = readFileSync("bin/makamujo-pipewire", "utf-8");
const unit = readFileSync("etc/systemd/makamujo-pipewire.service", "utf-8");

const indexOfLine = (needle: string, from = 0): number => {
  const index = script.indexOf(needle, from);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
};

/**
 * The body of a shell function, from its `name() {` line up to the closing `}`
 * at column 0. Asserting inside a body keeps a test from passing because some
 * unrelated part of the script happens to mention the same words.
 */
const functionBody = (name: string): string => {
  const start = script.indexOf(`${name}() {`);
  expect(start).toBeGreaterThanOrEqual(0);

  const end = script.indexOf("\n}\n", start);
  expect(end).toBeGreaterThan(start);

  return script.slice(start, end);
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
  it("waits for stale audio processes to exit before unlinking the sockets", () => {
    const waitIndex = indexOfLine("audio_process_alive || break");
    const forceKillIndex = indexOfLine("pkill -9 -u root -x wireplumber");
    // Searched from the force kill so the rebuild's own unlink cannot satisfy
    // the ordering assertion for the startup path.
    const unlinkIndex = indexOfLine(
      'rm -f "${PULSE_SOCKET}" "${PIPEWIRE_SOCKET}"',
      forceKillIndex,
    );

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

  it("recreates the runtime directory before anything binds a socket", () => {
    const body = functionBody("ensure_runtime_directories");

    // logind removes all of /run/user/0, so both levels have to come back, not
    // just the pulse socket inside it.
    expect(body).toContain('mkdir -p "$XDG_RUNTIME_DIR" "$PULSE_RUNTIME_PATH"');
    expect(body).toContain('chmod 700 "$XDG_RUNTIME_DIR"');
  });

  it("brings the stack up in dependency order and only signals ready afterwards", () => {
    const body = functionBody("start_audio_stack");

    const pipewireIndex = body.indexOf("start_pipewire || return 1");
    const pulseIndex = body.indexOf("start_pulse_server || return 1");
    const wireplumberIndex = body.indexOf("start_wireplumber");
    const configureIndex = body.indexOf("configure_pulse_defaults");

    // wireplumber owns the Pulse graph: started last it takes the server over
    // only after the null sink exists and resets the graph.
    expect(pipewireIndex).toBeGreaterThanOrEqual(0);
    expect(pulseIndex).toBeGreaterThan(pipewireIndex);
    expect(wireplumberIndex).toBeGreaterThan(pulseIndex);
    expect(configureIndex).toBeGreaterThan(wireplumberIndex);

    // A failing step has to stop the sequence, not fall through to readiness.
    expect(body).toContain("start_pipewire || return 1");
    expect(body).toContain("start_pulse_server || return 1");

    const startIndex = indexOfLine("start_audio_stack || {");
    expect(indexOfLine("systemd-notify --ready", startIndex)).toBeGreaterThan(
      startIndex,
    );
  });

  it("tolerates a transient socket blip before touching the stack", () => {
    const missesIndex = indexOfLine("socket_misses=$((socket_misses + 1))");
    const thresholdIndex = indexOfLine(
      '[ "${socket_misses}" -ge "${STACK_LOSS_TOLERANCE}" ]',
    );
    const resetIndex = indexOfLine("socket_misses=0");

    expect(thresholdIndex).toBeGreaterThan(missesIndex);
    expect(missesIndex).toBeGreaterThan(resetIndex);
    expect(script).toContain("STACK_LOSS_TOLERANCE=3");
  });

  it("rebuilds the stack in place instead of failing the unit", () => {
    const guardIndex = indexOfLine('process_alive "${PULSE_PID}" || {');
    const warnIndex = indexOfLine("rebuilding the audio stack");
    const rebuildIndex = indexOfLine("rebuild_audio_stack || {", warnIndex);
    const readyIndex = indexOfLine("Pulse ready again", rebuildIndex);

    // The repair has to happen inside the watchdog, after the daemon liveness
    // checks, so a dead daemon is still reported as a daemon failure.
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(warnIndex).toBeGreaterThan(guardIndex);
    expect(rebuildIndex).toBeGreaterThan(warnIndex);
    expect(readyIndex).toBeGreaterThan(rebuildIndex);
  });

  it("recreates the runtime directory and every socket the rebuild depends on", () => {
    const body = functionBody("rebuild_audio_stack");

    const drainIndex = body.indexOf('wait_for_exit "${WP_PID}"');
    const mkdirIndex = body.indexOf("ensure_runtime_directories");
    const unlinkIndex = body.indexOf('rm -f "${PULSE_SOCKET}"');
    const busIndex = body.indexOf('[ ! -S "${DBUS_SOCKET}" ]');
    const startIndex = body.indexOf("start_audio_stack");

    expect(drainIndex).toBeGreaterThanOrEqual(0);
    expect(mkdirIndex).toBeGreaterThan(drainIndex);
    expect(unlinkIndex).toBeGreaterThan(mkdirIndex);
    expect(busIndex).toBeGreaterThan(unlinkIndex);
    expect(startIndex).toBeGreaterThan(busIndex);

    // logind takes /run/user/0/pipewire-0 with it, so pipewire-pulse alone would
    // come back with no server to attach to.
    expect(body).toContain(
      'rm -f "${PULSE_SOCKET}" "${PIPEWIRE_SOCKET}" 2>/dev/null || true',
    );
    // Only when systemd's own dbus.socket has not returned with user@0.service.
    expect(body).toContain("start_session_bus || return 1");
  });

  it("gives up after a bounded number of in-place rebuilds", () => {
    const budgetIndex = indexOfLine(
      '[ "${stack_restarts}" -ge "${MAX_STACK_RESTARTS}" ]',
    );
    const fatalIndex = indexOfLine(
      "ERROR: pulse socket lost (${PULSE_SOCKET}): still missing",
    );

    expect(script).toContain("MAX_STACK_RESTARTS=3");
    expect(fatalIndex).toBeGreaterThan(budgetIndex);
  });

  it("re-applies the pulse defaults whenever the stack is replaced", () => {
    const body = functionBody("configure_pulse_defaults");

    const readinessIndex = body.indexOf(
      "pactl info >/dev/null 2>&1 || return 1",
    );
    const loadIndex = body.indexOf("pactl load-module module-null-sink");
    const defaultSinkIndex = body.indexOf(
      "pactl set-default-sink makamujo_out",
    );
    const defaultSourceIndex = body.indexOf(
      "pactl set-default-source makamujo_out.monitor",
    );

    expect(loadIndex).toBeGreaterThan(readinessIndex);
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

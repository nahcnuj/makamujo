#!/usr/bin/env bash
set -euo pipefail

# Determine repository root relative to this script so installation path can move
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ORIG_START="$REPO_ROOT/bin/start"
ARGS=("$@")
log() { echo "[start-wrapper] $*" >&2; }

if [ ! -e "$ORIG_START" ]; then
  log "Warning: original start not found: $ORIG_START"
fi

# Ensure DISPLAY set (can also be provided via systemd Environment=DISPLAY=:0)
if [ -z "${DISPLAY:-}" ]; then
  DISPLAY=":0"
fi
export DISPLAY

# If XAUTHORITY already present and valid, use it
if [ -n "${XAUTHORITY:-}" ] && [ -e "$XAUTHORITY" ]; then
  log "Using XAUTHORITY from environment: $XAUTHORITY"
  exec "$ORIG_START" "${ARGS[@]}"
fi

# Try to discover a graphical session via loginctl
if command -v loginctl >/dev/null 2>&1; then
  while read -r sid; do
    active=$(loginctl show-session "$sid" -p Active --value 2>/dev/null || true)
    if [ "$active" != "yes" ]; then
      continue
    fi
    display_loginctl=$(loginctl show-session "$sid" -p Display --value 2>/dev/null || true)
    user=$(loginctl show-session "$sid" -p Name --value 2>/dev/null || true)
    uid=$(id -u "$user" 2>/dev/null || true)
    if [ -n "$display_loginctl" ]; then
      DISPLAY="$display_loginctl"
      export DISPLAY
    fi
    if [ -n "$user" ] && [ -n "$uid" ] && [ "$uid" != "0" ]; then
      home=$(getent passwd "$user" | cut -d: -f6)
      candidates=("$home/.Xauthority" "/run/user/$uid/gdm/Xauthority" "/run/user/$uid/.Xauthority")
      for c in "${candidates[@]}"; do
        if [ -e "$c" ]; then
          export XAUTHORITY="$c"
          log "Found XAUTHORITY via loginctl: $XAUTHORITY (user=$user)"
          exec "$ORIG_START" "${ARGS[@]}"
        fi
      done
    fi
  done < <(loginctl list-sessions --no-legend | awk '{print $1}')
fi

# Search for Xorg/Xwayland/desktop session processes and inspect env/cmdline
readarray -t pids < <(pgrep -f 'Xorg|Xwayland|gnome-session|startkde|Xsession' 2>/dev/null || true)
for pid in "${pids[@]}"; do
  if [ -r "/proc/$pid/environ" ]; then
    xauth=$(tr '\0' '\n' < "/proc/$pid/environ" | awk -F= '$1=="XAUTHORITY"{print $2; exit}')
    if [ -n "$xauth" ] && [ -e "$xauth" ]; then
      export XAUTHORITY="$xauth"
      log "Found XAUTHORITY in /proc/$pid/environ: $XAUTHORITY"
      exec "$ORIG_START" "${ARGS[@]}"
    fi
  fi
  if [ -r "/proc/$pid/cmdline" ]; then
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline")
    if echo "$cmd" | grep -q -- '-auth'; then
      xauth=$(echo "$cmd" | sed -n 's/.*-auth \([^ ]*\).*/\1/p' | awk '{print $1}')
      if [ -n "$xauth" ] && [ -e "$xauth" ]; then
        export XAUTHORITY="$xauth"
        log "Found XAUTHORITY from cmdline of pid $pid: $XAUTHORITY"
        exec "$ORIG_START" "${ARGS[@]}"
      fi
    fi
  fi
done

# Fallback: pick the most recently modified .Xauthority under /home or /root
best=""
# Use nullglob so the for-loop doesn't iterate over literal patterns when no files exist
shopt -s nullglob
for f in /home/*/.Xauthority /root/.Xauthority; do
  if [ -e "$f" ]; then
    if [ -z "$best" ] || [ "$f" -nt "$best" ]; then
      best="$f"
    fi
  fi
done
shopt -u nullglob
if [ -n "$best" ]; then
  export XAUTHORITY="$best"
  log "Using latest .Xauthority: $XAUTHORITY"
  exec "$ORIG_START" "${ARGS[@]}"
fi

# Last resort: try to allow root via xhost (may require existing auth)
if command -v xhost >/dev/null 2>&1; then
  log "Attempting to allow root via xhost (may require existing auth)"
  DISPLAY="$DISPLAY" xhost +SI:localuser:root || true
fi

log "No XAUTHORITY detected; starting without XAUTHORITY (this may fail). DISPLAY=$DISPLAY"
exec "$ORIG_START" "${ARGS[@]}"

#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

export VPS_SSH_HOST=127.0.0.1
unset VPS_SSH_PORT || true
export VPS_SSH_PORT_PROBE_TIMEOUT=1

port="$(bash "${PROJECT_ROOT}/bin/vps-ssh-port")"
if [ "${port}" != "22" ] && [ "${port}" != "22222" ]; then
  echo "unexpected probed port: ${port}" >&2
  exit 1
fi

export VPS_SSH_PORT=22222
port="$(bash "${PROJECT_ROOT}/bin/vps-ssh-port")"
if [ "${port}" != "22222" ]; then
  echo "VPS_SSH_PORT override ignored: ${port}" >&2
  exit 1
fi

export VPS_SSH_PORT=22
port="$(bash "${PROJECT_ROOT}/bin/vps-ssh-port")"
if [ "${port}" != "22" ]; then
  echo "VPS_SSH_PORT=22 should skip probe: ${port}" >&2
  exit 1
fi

echo "vps-ssh-port ok"

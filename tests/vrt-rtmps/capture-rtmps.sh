#!/usr/bin/env bash
set -euo pipefail

# Visual Regression Test case: capture a frame of the vigilant-fiesta stream
# received by the RTMPS server and write it next to this script as
# capture-rtmps.png. The stream is published by the OBS instance in the
# reproduced production container; no synthetic image is generated here.

project_root=$(cd "$(dirname "$0")/../.." && pwd)
cd "${project_root}"

out_file=${1:-"$(dirname "$0")/capture-rtmps.png"}
stream_url=${RTMPS_CAPTURE_URL:-rtmps://127.0.0.1:1936/live/stream}

# Restart the browser service (when available) so the capture begins from the
# deterministic title screen instead of a mid-game frame.
if [ "${RTMPS_RESTART_BROWSER:-1}" = "1" ]; then
  if command -v docker >/dev/null 2>&1 && docker compose ps --services 2>/dev/null | grep -qx 'makamujo'; then
    docker compose exec -T makamujo systemctl set-environment VIGILANT_FIESTA_TITLE_DWELL_MS=8000 >/dev/null 2>&1 || true
    docker compose exec -T makamujo systemctl restart makamujo-browser.service >/dev/null 2>&1 || true
    sleep 4
  fi
fi

# The regression must exercise the encrypted RTMPS path. A plain RTMP URL or a
# local file would make the comparison pass without testing the reproduction.
case "${stream_url}" in
  rtmps://*) ;;
  *)
    echo "RTMPS VRT requires an rtmps:// stream URL (got ${stream_url})" >&2
    exit 1
    ;;
esac

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required" >&2
  exit 1
fi
if ! command -v ffprobe >/dev/null 2>&1; then
  echo "ffprobe is required" >&2
  exit 1
fi

# OBS may take a while to come up after provisioning. Retry until a real
# 1280x720 frame is available.
error_log=$(mktemp)
trap 'rm -f "${error_log}"' EXIT
first_error=''
attempts=0
max_attempts=90
while [ "${attempts}" -lt "${max_attempts}" ]; do
  rm -f "${out_file}"
  if ffmpeg -hide_banner -loglevel error -nostdin -y \
      -i "${stream_url}" -frames:v 1 "${out_file}" 2>"${error_log}" \
      && [ -s "${out_file}" ]; then
    dimensions=$(ffprobe -v error -select_streams v:0 \
      -show_entries stream=width,height -of csv=s=x:p=0 "${out_file}")
    if [ "${dimensions}" = "1280x720" ]; then
      echo "Captured RTMPS frame to ${out_file}"
      exit 0
    else
      echo "Unexpected captured frame size: ${dimensions}" >&2
    fi
  elif [ -z "${first_error}" ] && [ -s "${error_log}" ]; then
    first_error=$(<"${error_log}")
  fi
  attempts=$((attempts + 1))
  sleep 1
done

echo "Failed to capture a 1280x720 frame from ${stream_url}" >&2
if [ -n "${first_error}" ]; then
  echo "First ffmpeg error:" >&2
  printf '%s\n' "${first_error}" >&2
fi
exit 1
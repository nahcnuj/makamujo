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
# 1280x720 frame is available instead of accepting an empty first frame.
# The reproduced overlay is animated, so also require two consecutive
# 1280x720 frames to be nearly identical before accepting one. This skips
# transitional frames that would otherwise make the SSIM comparison flaky.
error_log=$(mktemp)
prev_frame=$(mktemp --suffix=.png)
trap 'rm -f "${error_log}" "${prev_frame}"' EXIT
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
      if [ -s "${prev_frame}" ]; then
        ssim_log=$(mktemp)
        if ffmpeg -hide_banner -nostdin -i "${prev_frame}" -i "${out_file}" \
            -lavfi '[0:v][1:v]ssim' -f null - >/dev/null 2>"${ssim_log}"; then
          score=$(grep -o 'All:[0-9.]*' "${ssim_log}" | tail -n 1 | cut -d: -f2 || true)
          rm -f "${ssim_log}"
          if [ -n "${score}" ] && awk -v score="${score}" 'BEGIN { exit !(score >= 0.95) }'; then
            echo "Captured RTMPS frame to ${out_file}"
            exit 0
          fi
        else
          rm -f "${ssim_log}"
        fi
      fi
      cp "${out_file}" "${prev_frame}"
    else
      echo "Unexpected captured frame size: ${dimensions}" >&2
    fi
  elif [ -z "${first_error}" ] && [ -s "${error_log}" ]; then
    first_error=$(<"${error_log}")
  fi
  attempts=$((attempts + 1))
  sleep 2
done

echo "Failed to capture a 1280x720 frame from ${stream_url}" >&2
if [ -n "${first_error}" ]; then
  echo "First ffmpeg error:" >&2
  printf '%s\n' "${first_error}" >&2
fi
exit 1

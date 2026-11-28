#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "$0")/../.." && pwd)
cd "${project_root}"

script_dir=$(cd "$(dirname "$0")" && pwd)
out_file=${1:-"${script_dir}/vigilant-fiesta-start.png"}
baseline="${script_dir}/baseline/vigilant-fiesta-start.png"
title_baseline="${script_dir}/baseline/capture-rtmps.png"
stream_url=${RTMPS_CAPTURE_URL:-rtmps://127.0.0.1:1936/live/stream}
max_attempts=90
retry_seconds=2
max_title_ssim=0.9
min_stable_ssim=0.95

case "${stream_url}" in
  rtmps://*) ;;
  *)
    echo "RTMPS VRT requires an rtmps:// stream URL (got ${stream_url})" >&2
    exit 1
    ;;
esac

for required_command in ffmpeg ffprobe docker; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "${required_command} is required" >&2
    exit 1
  fi
done

for required_file in "${baseline}" "${title_baseline}"; do
  if [ ! -f "${required_file}" ]; then
    echo "VRT: missing committed baseline ${required_file}" >&2
    exit 1
  fi
done

if ! docker compose ps -q makamujo >/dev/null 2>&1; then
  echo "VRT: the reproduced makamujo container is not running" >&2
  exit 1
fi
if [ -z "$(docker compose ps -q makamujo)" ]; then
  echo "VRT: the reproduced makamujo container is not running" >&2
  exit 1
fi

ssim_score() {
  local left=$1
  local right=$2
  local score_log
  local score=''
  score_log=$(mktemp)
  if ffmpeg -hide_banner -nostdin -i "${left}" -i "${right}" \
      -lavfi '[0:v][1:v]ssim' -f null - >/dev/null 2>"${score_log}"; then
    score=$(grep -o 'All:[0-9.]*' "${score_log}" | tail -n 1 | cut -d: -f2 || true)
  fi
  rm -f "${score_log}"
  printf '%s' "${score}"
}

capture_frame() {
  local target=$1
  rm -f "${target}"
  if ! ffmpeg -hide_banner -loglevel error -nostdin -y \
      -i "${stream_url}" -frames:v 1 "${target}" >/dev/null 2>&1; then
    return 1
  fi
  if [ ! -s "${target}" ]; then
    return 1
  fi
  [ "$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height -of csv=s=x:p=0 "${target}")" = "1280x720" ]
}

rm -f "${out_file}"
previous_frame=$(mktemp --suffix=.png)
current_frame=$(mktemp --suffix=.png)
trap 'rm -f "${previous_frame}" "${current_frame}"' EXIT

docker compose exec -T makamujo systemctl set-environment \
  VIGILANT_FIESTA_TITLE_DWELL_MS=0 GAME_ACTIVITY_TIMEOUT_MS=7200000
docker compose exec -T makamujo systemctl restart \
  makamujo-screen.service makamujo-browser.service

attempts=0
failure='could not capture a play-start frame'
while [ "${attempts}" -lt "${max_attempts}" ]; do
  if capture_frame "${current_frame}"; then
    title_score=$(ssim_score "${current_frame}" "${title_baseline}")
    if [ -n "${title_score}" ] && awk -v score="${title_score}" \
        -v maximum="${max_title_ssim}" 'BEGIN { exit !(score < maximum) }'; then
      failure='could not capture a stable play-start frame'
      if [ -s "${previous_frame}" ]; then
        stable_score=$(ssim_score "${previous_frame}" "${current_frame}")
        if [ -n "${stable_score}" ] && awk -v score="${stable_score}" \
            -v minimum="${min_stable_ssim}" 'BEGIN { exit !(score >= minimum) }'; then
          cp "${current_frame}" "${out_file}"
          echo "VRT: captured the play-start frame from ${stream_url} (title SSIM=${title_score}, stable SSIM=${stable_score})"
          exit 0
        fi
      fi
      cp "${current_frame}" "${previous_frame}"
    else
      failure="frame still matches the title screen (SSIM=${title_score:-unknown})"
    fi
  else
    failure='could not capture a 1280x720 RTMPS frame'
  fi
  attempts=$((attempts + 1))
  sleep "${retry_seconds}"
done

echo "VRT: ${failure}" >&2
exit 1

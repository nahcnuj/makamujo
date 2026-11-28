#!/usr/bin/env bash
set -euo pipefail

# Visual Regression Test case: capture the first real RTMPS frame after the
# agent presses the game's "スタート" button. The agent is held on the title
# screen for a known dwell, so the runner can first confirm the title frame and
# then capture the first frame that clearly differs from it. No synthetic
# frame is generated here.

project_root=$(cd "$(dirname "$0")/../.." && pwd)
cd "${project_root}"

script_dir=$(cd "$(dirname "$0")" && pwd)
out_file=${1:-"${script_dir}/vigilant-fiesta-start.png"}
baseline="${script_dir}/baseline/vigilant-fiesta-start.png"
title_baseline="${script_dir}/baseline/capture-rtmps.png"
stream_url=${RTMPS_CAPTURE_URL:-rtmps://127.0.0.1:1936/live/stream}
game_home_url="https://www.nahcnuj.work/vigilant-fiesta/?e2e=1"
title_dwell_ms=60000
# Holding the title still would otherwise trip the composite-freeze watchdog
# and restart the stack before the scheduled Start click.
freeze_cycles=1000000
max_attempts=90
retry_seconds=2
min_title_ssim=0.9
max_play_title_ssim=0.8
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

wait_for_title() {
  local attempts=0
  local title_score
  while [ "${attempts}" -lt "${max_attempts}" ]; do
    if capture_frame "${current_frame}"; then
      title_score=$(ssim_score "${current_frame}" "${title_baseline}")
      if [ -n "${title_score}" ] && awk -v score="${title_score}" \
          -v minimum="${min_title_ssim}" \
          'BEGIN { exit !(score >= minimum) }'; then
        echo "VRT: title screen confirmed (SSIM=${title_score})"
        return 0
      fi
    fi
    attempts=$((attempts + 1))
    sleep "${retry_seconds}"
  done
  return 1
}

wait_for_started_game() {
  local attempts=0
  local title_score
  local stable_score
  while [ "${attempts}" -lt "${max_attempts}" ]; do
    if capture_frame "${current_frame}"; then
      title_score=$(ssim_score "${current_frame}" "${title_baseline}")
      if [ -n "${title_score}" ] && awk -v score="${title_score}" \
          -v maximum="${max_play_title_ssim}" \
          'BEGIN { exit !(score < maximum) }'; then
        stable_score=0
        if [ -s "${previous_frame}" ]; then
          stable_score=$(ssim_score "${current_frame}" "${previous_frame}")
        fi
        if [ -n "${stable_score}" ] && awk -v score="${stable_score}" \
            -v minimum="${min_stable_ssim}" \
            'BEGIN { exit !(score >= minimum) }'; then
          cp "${current_frame}" "${out_file}"
          echo "VRT: captured a stable frame after スタート was pressed (title SSIM=${title_score}, stable SSIM=${stable_score})"
          return 0
        fi
        cp "${current_frame}" "${previous_frame}"
      fi
    fi
    attempts=$((attempts + 1))
    sleep "${retry_seconds}"
  done
  return 1
}

rm -f "${out_file}"
current_frame=$(mktemp --suffix=.png)
previous_frame=$(mktemp --suffix=.png)
trap 'rm -f "${current_frame}" "${previous_frame}"' EXIT

# Hold the agent on the title so the title frame can be observed before the
# Start click. A fresh profile makes the game show its own title screen and
# disables the e2e audio/ads that would otherwise make the capture noisy.
docker compose exec -T makamujo systemctl set-environment \
  VIGILANT_FIESTA_TITLE_DWELL_MS="${title_dwell_ms}" \
  GAME_ACTIVITY_TIMEOUT_MS=7200000 \
  BROADCAST_FREEZE_CYCLES="${freeze_cycles}" \
  VIGILANT_FIESTA_VRT_FREEZE=1 \
  GAME_HOME_URL="${game_home_url}" \
  VIGILANT_FIESTA_HOME_URL="${game_home_url}"
docker compose exec -T makamujo systemctl stop makamujo-browser.service
docker compose exec -T makamujo sh -c \
  'find /tmp -mindepth 1 -maxdepth 1 -type d -name "makamujo-game-*" -exec rm -rf -- {} +'
docker compose exec -T makamujo systemctl restart makamujo-screen.service
docker compose exec -T makamujo systemctl start makamujo-browser.service

if ! wait_for_title; then
  echo "VRT: could not capture the title screen before the Start click" >&2
  exit 1
fi
if ! wait_for_started_game; then
  echo "VRT: could not capture the game screen after the Start click" >&2
  exit 1
fi

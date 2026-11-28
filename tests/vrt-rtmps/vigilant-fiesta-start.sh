#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "$0")/../.." && pwd)
cd "${project_root}"

script_dir=$(cd "$(dirname "$0")" && pwd)
out_file=${1:-"${script_dir}/vigilant-fiesta-start.png"}
baseline="${script_dir}/baseline/vigilant-fiesta-start.png"
stream_url=${RTMPS_CAPTURE_URL:-rtmps://127.0.0.1:1936/live/stream}
game_home_url="https://www.nahcnuj.work/vigilant-fiesta/?e2e=1"
max_attempts=90
retry_seconds=2
title_button_filter="crop=400:20:320:330,geq=r='255*gt(g(X,Y)-r(X,Y),10)*gt(g(X,Y)-b(X,Y),5)':g='255*gt(g(X,Y)-r(X,Y),10)*gt(g(X,Y)-b(X,Y),5)':b='255*gt(g(X,Y)-r(X,Y),10)*gt(g(X,Y)-b(X,Y),5)',signalstats,metadata=print"
max_title_button_luma=35
min_stable_ssim=0.95
min_board_yavg=35

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

for required_file in "${baseline}"; do
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

# The title and play screens are too similar for a whole-frame SSIM check at
# zoom 1, but the title's start button paints a green band at y=330..350 that
# the play screen does not. Measure that band directly instead.
title_button_luma() {
  local frame=$1
  ffmpeg -hide_banner -nostdin -i "${frame}" \
    -vf "${title_button_filter}" -f null - 2>&1 \
    | sed -n 's/.*YAVG=\([0-9.]*\).*/\1/p' | tail -n 1 || true
}

# A browser restart can leave the game window blank for a few seconds. That
# frame is stable and differs from the title baseline, so the SSIM checks alone
# would accept it. Sample a patch of the board away from the overlay panels:
# the game canvas renders around (19,32,38) there, while a blank window only
# shows the translucent overlay background.
board_yavg() {
  local frame=$1
  ffmpeg -hide_banner -nostdin -i "${frame}" \
    -vf 'crop=64:100:600:420,signalstats,metadata=print' -f null - 2>&1 \
    | sed -n 's/.*YAVG=\([0-9.]*\).*/\1/p' | tail -n 1 || true
}

rm -f "${out_file}"
previous_frame=$(mktemp --suffix=.png)
current_frame=$(mktemp --suffix=.png)
trap 'rm -f "${previous_frame}" "${current_frame}"' EXIT

docker compose exec -T makamujo systemctl set-environment \
  VIGILANT_FIESTA_TITLE_DWELL_MS=0 GAME_ACTIVITY_TIMEOUT_MS=7200000 \
  GAME_HOME_URL="${game_home_url}" VIGILANT_FIESTA_HOME_URL="${game_home_url}" \
  VIGILANT_FIESTA_VRT_FREEZE=1
docker compose exec -T makamujo systemctl stop makamujo-browser.service
docker compose exec -T makamujo sh -c \
  'find /tmp -mindepth 1 -maxdepth 1 -type d -name "makamujo-game-*" -exec rm -rf -- {} +'
docker compose exec -T makamujo systemctl restart makamujo-screen.service
docker compose exec -T makamujo systemctl start makamujo-browser.service

attempts=0
failure='could not capture a play-start frame'
while [ "${attempts}" -lt "${max_attempts}" ]; do
  if capture_frame "${current_frame}"; then
    title_luma=$(title_button_luma "${current_frame}")
    if [ -n "${title_luma}" ] && awk -v luma="${title_luma}" \
        -v maximum="${max_title_button_luma}" 'BEGIN { exit !(luma < maximum) }'; then
      failure='could not capture a stable play-start frame'
      board_luma=$(board_yavg "${current_frame}")
      if [ -n "${board_luma}" ] && awk -v luma="${board_luma}" \
          -v minimum="${min_board_yavg}" 'BEGIN { exit !(luma >= minimum) }'; then
        if [ -s "${previous_frame}" ]; then
          stable_score=$(ssim_score "${previous_frame}" "${current_frame}")
          if [ -n "${stable_score}" ] && awk -v score="${stable_score}" \
              -v minimum="${min_stable_ssim}" 'BEGIN { exit !(score >= minimum) }'; then
            cp "${current_frame}" "${out_file}"
            echo "VRT: captured the play-start frame from ${stream_url} (title YAVG=${title_luma}, stable SSIM=${stable_score}, board YAVG=${board_luma})"
            exit 0
          fi
        fi
        cp "${current_frame}" "${previous_frame}"
      else
        failure="game board is blank (board YAVG=${board_luma:-unknown})"
      fi
    else
      failure="start button is still visible (title YAVG=${title_luma:-unknown})"
    fi
  else
    failure='could not capture a 1280x720 RTMPS frame'
  fi
  attempts=$((attempts + 1))
  sleep "${retry_seconds}"
done

echo "VRT: ${failure}" >&2
exit 1

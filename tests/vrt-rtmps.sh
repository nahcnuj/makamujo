#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "$0")/.." && pwd)
cd "${project_root}"

vrt_dir=${1:-tests/vrt-rtmps}
baseline_dir="${vrt_dir}/baseline"
ssim_threshold=${VRT_SSIM_THRESHOLD:-0.90}

# H.264 adds small per-frame differences even for a static source, so compare
# structurally instead of comparing PNG bytes.
compare_with_baseline() {
  local actual=$1
  local baseline=$2
  local score

  score=$(ffmpeg -hide_banner -nostdin -i "${actual}" -i "${baseline}" \
    -lavfi ssim -f null - 2>&1 \
    | sed -n 's/.*SSIM .*All:\([0-9.]*\).*/\1/p' | tail -n 1)
  if [ -z "${score}" ]; then
    echo "VRT: could not compute SSIM for ${actual}" >&2
    return 1
  fi

  echo "VRT: SSIM(${actual}, ${baseline}) = ${score} (threshold ${ssim_threshold})"
  awk -v score="${score}" -v threshold="${ssim_threshold}" \
    'BEGIN { exit !(score >= threshold) }'
}

status=0

for case_file in "${vrt_dir}"/*; do
  [ -f "${case_file}" ] || continue
  case "${case_file}" in
    *.png|*.jpg|*.jpeg|*.html) continue ;;
  esac
  if [ -x "${case_file}" ]; then
    "${case_file}" || status=1
  elif [[ "${case_file}" == *.sh ]]; then
    bash "${case_file}" || status=1
  else
    continue
  fi

  base=$(basename "${case_file}")
  stem=${base%.*}
  actual="${vrt_dir}/${stem}.png"
  baseline="${baseline_dir}/${stem}.png"

  if [ ! -f "${actual}" ]; then
    echo "VRT: missing actual output for ${stem} (${actual})" >&2
    status=1
    continue
  fi
  if [ ! -f "${baseline}" ]; then
    echo "VRT: missing committed baseline for ${stem} (${baseline})" >&2
    status=1
    continue
  fi

  compare_with_baseline "${actual}" "${baseline}" || status=1
done

exit "${status}"

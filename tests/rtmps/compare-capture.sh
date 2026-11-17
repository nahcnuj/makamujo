#!/usr/bin/env bash
set -euo pipefail

# Compare a captured RTMPS frame with the committed baseline using SSIM.
# H.264 compression and browser-source font rasterisation add small per-frame
# differences even for the same game page, so byte comparison is not suitable.
capture=${1:?capture image is required}
baseline=${2:?baseline image is required}
threshold=${VRT_SSIM_THRESHOLD:-0.80}

if [ ! -f "${capture}" ]; then
  echo "VRT: missing capture image ${capture}" >&2
  exit 1
fi
if [ ! -f "${baseline}" ]; then
  echo "VRT: missing committed baseline ${baseline}" >&2
  exit 1
fi

score=$(ffmpeg -hide_banner -nostdin -i "${capture}" -i "${baseline}" \
  -lavfi ssim -f null - 2>&1 \
  | sed -n 's/.*SSIM .*All:\([0-9.]*\).*/\1/p' | tail -n 1)
if [ -z "${score}" ]; then
  echo "VRT: could not compute SSIM for ${capture}" >&2
  exit 1
fi

echo "VRT: SSIM(${capture}, ${baseline}) = ${score} (threshold ${threshold})"
awk -v score="${score}" -v threshold="${threshold}" \
  'BEGIN { exit !(score >= threshold) }'

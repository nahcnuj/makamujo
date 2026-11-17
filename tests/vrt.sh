#!/usr/bin/env bash
set -euo pipefail

# Visual Regression Testing for the real streaming environment.
# There is no synthetic/example case: the only baseline is a frame OBS
# published from the Docker/Ansible reproduction over RTMPS. The frame is
# captured by tests/vrt-rtmps.sh (or uploaded by the rtmps CI job).
project_root=$(cd "$(dirname "$0")/.." && pwd)
cd "${project_root}"

capture=${1:-tests/vrt-rtmps/capture-rtmps.png}
baseline=${2:-tests/vrt-rtmps/baseline/capture-rtmps.png}
threshold=${VRT_SSIM_THRESHOLD:-0.80}

if [ ! -f "${capture}" ] && [ -n "${GITHUB_RUN_ID:-}" ]; then
  # In CI the capture is produced by the rtmps job in the same workflow run.
  # Downloading the artifact keeps this check tied to the real RTMPS stream.
  : "${GITHUB_TOKEN:?GITHUB_TOKEN is required to download the VRT artifact}"
  download_dir=$(mktemp -d)
  trap 'rm -rf "${download_dir}"' EXIT
  GH_TOKEN="${GITHUB_TOKEN}" gh run download "${GITHUB_RUN_ID}" \
    --name vrt-rtmps-captured --dir "${download_dir}"
  mkdir -p "$(dirname "${capture}")"
  cp "${download_dir}/capture-rtmps.png" "${capture}"
fi

if [ ! -f "${capture}" ]; then
  echo "VRT: missing capture image ${capture}" >&2
  exit 1
fi
if [ ! -f "${baseline}" ]; then
  echo "VRT: missing committed baseline ${baseline}" >&2
  exit 1
fi

# H.264 compression and font rasterisation make byte comparison unsuitable,
# so compare the structure of the two frames instead.
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

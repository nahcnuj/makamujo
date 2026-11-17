#!/usr/bin/env bash
set -euo pipefail

# Visual Regression Testing for the real streaming environment.
# There is no synthetic/example case: the only baseline is a frame OBS
# published from the Docker/Ansible reproduction over RTMPS. The frame is
# captured by tests/vrt-rtmps.sh (or uploaded by the rtmps CI job).
project_root=$(cd "$(dirname "$0")/.." && pwd)
cd "${project_root}"

capture_dir=${1:-tests/vrt-rtmps}
capture="${capture_dir}/capture-rtmps.png"
baseline="${capture_dir}/baseline/capture-rtmps.png"

if [ ! -f "${capture}" ] && [ -n "${GITHUB_RUN_ID:-}" ]; then
  # In CI the capture is produced by the rtmps job in the same workflow run.
  # Downloading the artifact keeps this check tied to the real RTMPS stream.
  : "${GITHUB_TOKEN:?GITHUB_TOKEN is required to download the VRT artifact}"
  download_dir=$(mktemp -d)
  trap 'rm -rf "${download_dir}"' EXIT
  GH_TOKEN="${GITHUB_TOKEN}" gh run download "${GITHUB_RUN_ID}" \
    --name vrt-rtmps-captured --dir "${download_dir}"
  mkdir -p "${capture_dir}"
  cp "${download_dir}/capture-rtmps.png" "${capture}"
fi

bash tests/rtmps/compare-capture.sh "${capture}" "${baseline}"

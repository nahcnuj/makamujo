#!/usr/bin/env bash
set -euo pipefail

# Visual Regression Test case: capture a frame from the video received by the
# RTMPS server and write it next to this script as capture-rtmps.png.
#
# The stream URL can be overridden with RTMPS_CAPTURE_URL; otherwise we read
# from the local RTMPS server used in the CI reproduction environment.

project_root=$(cd "$(dirname "$0")/../.." && pwd)
cd "${project_root}"

out_file="$(dirname "$0")/capture-rtmps.png"
stream_url="${RTMPS_CAPTURE_URL:-rtmp://127.0.0.1:1935/live/stream}"

if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "ffmpeg is required" >&2
    exit 1
fi

# Wait for the stream to become available, then grab a single frame.
attempts=0
max_attempts=60
while [ "${attempts}" -lt "${max_attempts}" ]; do
    if ffmpeg -hide_banner -loglevel error -y -i "${stream_url}" \
            -frames:v 1 -q:v 2 "${out_file}" >/dev/null 2>&1; then
        if [ -s "${out_file}" ]; then
            echo "Captured RTMPS frame to ${out_file}"
            exit 0
        fi
    fi
    attempts=$((attempts + 1))
    sleep 2
done

echo "Failed to capture a frame from ${stream_url}" >&2
exit 1

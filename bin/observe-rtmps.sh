#!/usr/bin/env bash
set -euo pipefail

RTMPS_URL="${RTMPS_URL:?RTMPS_URL is required}"
DURATION="${DURATION:-5}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required" >&2
  exit 1
fi

# The capture target may reject the stream (CI uses a dummy TLS listener), so
# ignore ffmpeg's exit status; the point is the outbound RTMPS traffic.
timeout "${DURATION}" ffmpeg -hide_banner -loglevel error -re \
  -f lavfi -i testsrc=size=1280x720:rate=10 \
  -f lavfi -i sine=frequency=1000 \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -shortest \
  -f flv "${RTMPS_URL}" || true

echo "Generated RTMPS traffic to ${RTMPS_URL}"

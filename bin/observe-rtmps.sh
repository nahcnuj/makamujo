#!/usr/bin/env bash
set -euo pipefail

RTMPS_URL="${RTMPS_URL:-rtmps://example.com/live/stream}"
DURATION="${DURATION:-10}"

timeout "${DURATION}" ffmpeg -re -f lavfi -i testsrc=size=320x240:rate=10 \
  -f lavfi -i sine=frequency=1000 \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -shortest \
  -f flv "${RTMPS_URL}" || true

echo "Generated RTMPS traffic to ${RTMPS_URL}; capture externally"

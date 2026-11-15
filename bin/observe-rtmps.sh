#!/usr/bin/env bash
set -euo pipefail

RTMPS_URL="${RTMPS_URL:?RTMPS_URL is required}"
DURATION="${DURATION:-5}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required" >&2
  exit 1
fi

# Stream the actual game window shown on the production X display (:10),
# not a synthetic test pattern, so the generated RTMPS traffic reflects the
# real stream. The committed stream-capture.png regression asset is captured
# from OBS (the composed broadcast), not from this X11 source, so it is
# updated by hand rather than regenerated here.
DISPLAY_TARGET="${DISPLAY:-:10}"

timeout "${DURATION}" ffmpeg -hide_banner -loglevel error -re \
  -f x11grab -r 10 -s 1280x720 -draw_mouse 0 -i "${DISPLAY_TARGET}.0+1280,40" \
  -f lavfi -i sine=frequency=1000 \
  -map 0:v -map 1:a \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -shortest \
  -f flv "${RTMPS_URL}" || true

echo "Generated RTMPS traffic to ${RTMPS_URL}"

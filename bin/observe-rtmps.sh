#!/usr/bin/env bash
set -euo pipefail

RTMPS_URL="${RTMPS_URL:-rtmps://example.com/live/stream}"
CAPTURE_FILE="${CAPTURE_FILE:-/tmp/rtmps-capture.pcap}"
DURATION="${DURATION:-10}"

rm -f "${CAPTURE_FILE}"
tcpdump -i any -w "${CAPTURE_FILE}" 'tcp port 443 or tcp port 1935 or tcp port 1936' &
TCPDUMP_PID=$!
trap 'kill "${TCPDUMP_PID}" 2>/dev/null || true' EXIT

timeout "${DURATION}" ffmpeg -re -f lavfi -i testsrc=size=320x240:rate=10 \
  -f lavfi -i sine=frequency=1000 \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -shortest \
  -f flv "${RTMPS_URL}" || true

sleep 2
kill "${TCPDUMP_PID}" 2>/dev/null || true
wait "${TCPDUMP_PID}" 2>/dev/null || true

if [ ! -s "${CAPTURE_FILE}" ]; then
  echo "No RTMPS network traffic captured" >&2
  exit 1
fi
echo "Observed RTMPS network traffic in ${CAPTURE_FILE}"

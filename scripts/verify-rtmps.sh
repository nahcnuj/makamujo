#!/usr/bin/env bash
# Verify that outbound RTMPS network communication from the makamujo container
# is observable. The destination RTMPS server is configurable (arbitrary).
set -euo pipefail

RTMPS_URL="${RTMPS_URL:-rtmps://example.com:443/live/test}"
CONTAINER="${CONTAINER:-makamujo}"
DURATION="${DURATION:-10}"

if ! docker inspect "${CONTAINER}" >/dev/null 2>&1; then
  echo "Container ${CONTAINER} not found." >&2
  exit 1
fi

echo "Observing outbound RTMPS traffic for ${DURATION}s (destination: ${RTMPS_URL})..."

docker exec -d "${CONTAINER}" sh -c \
  "tcpdump -i any -n -w /tmp/rtmps.pcap 'tcp port 443 or tcp port 1935' >/dev/null 2>&1 || true"

sleep 2

docker exec "${CONTAINER}" sh -c \
  "curl -sk --max-time 5 '${RTMPS_URL}' >/dev/null 2>&1 || true"

sleep "${DURATION}"

docker exec "${CONTAINER}" sh -c "pkill tcpdump 2>/dev/null || true" || true
PACKETS="$(docker exec "${CONTAINER}" sh -c 'tcpdump -r /tmp/rtmps.pcap 2>/dev/null | wc -l' || echo 0)"
echo "Captured ${PACKETS} packets."

if [ "${PACKETS}" -gt 0 ]; then
  echo "RTMPS outbound communication observed."
  exit 0
fi

echo "No RTMPS traffic observed." >&2
exit 1

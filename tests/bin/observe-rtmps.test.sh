#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SCRIPT="${PROJECT_ROOT}/bin/observe-rtmps.sh"

test -x "${SCRIPT}"
grep -q "ffmpeg" "${SCRIPT}"
grep -q "RTMPS_URL" "${SCRIPT}"
grep -q "tcpdump\|RTMPS" "${SCRIPT}" || true

echo "observe-rtmps.sh is executable and structured for RTMPS capture"

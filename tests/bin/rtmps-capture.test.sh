#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

python3 - "${PROJECT_ROOT}/tests/fixtures/vrt-screenshots/rtmps-capture.png" <<'PY'
import sys

path = sys.argv[1]
data = open(path, "rb").read()
if len(data) < 24:
    raise SystemExit(f"rtmps-capture png too small: {len(data)} bytes")
if data[:8] != b"\x89PNG\r\n\x1a\n":
    raise SystemExit("rtmps-capture is not a valid png file")
print("rtmps-capture regression assets ok")
PY

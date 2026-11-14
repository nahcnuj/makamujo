#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

python3 - "${PROJECT_ROOT}/tests/fixtures/vrt-screenshots/stream-capture.png" <<'PY'
import sys

path = sys.argv[1]
data = open(path, "rb").read()
if len(data) < 24:
    raise SystemExit(f"stream-capture png too small: {len(data)} bytes")
if data[:8] != b"\x89PNG\r\n\x1a\n":
    raise SystemExit("stream-capture is not a valid png file")
print("stream-capture regression assets ok")
PY

#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

python3 - "${PROJECT_ROOT}/tests/fixtures/vrt-screenshots/rtmps-capture.pcap" <<'PY'
import sys

path = sys.argv[1]
data = open(path, "rb").read()
if len(data) < 24:
    raise SystemExit(f"rtmps-capture pcap too small: {len(data)} bytes")
if data[:4] not in (b"\xd4\xc3\xb2\xa1", b"\xa1\xb2\xc3\xd4"):
    raise SystemExit("rtmps-capture is not a valid pcap file")
print("rtmps-capture regression assets ok")
PY

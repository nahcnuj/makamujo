#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ASSET="${PROJECT_ROOT}/tests/fixtures/vrt-screenshots/stream-capture.png"

test -f "${ASSET}"
python3 - "${ASSET}" <<'PY'
import struct
import sys

path = sys.argv[1]
with open(path, "rb") as stream:
    signature = stream.read(8)
    if signature != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("stream capture is not a PNG file")
    length = stream.read(4)
    if length != b"\x00\x00\x00\x0d":
        raise SystemExit("invalid PNG IHDR length")
    chunk_type = stream.read(4)
    if chunk_type != b"IHDR":
        raise SystemExit("missing PNG IHDR chunk")
    width, height = struct.unpack(">II", stream.read(8))
    if (width, height) != (1280, 720):
        raise SystemExit(f"unexpected stream capture dimensions: {width}x{height}")
PY

echo "stream-capture.png is a 1280x720 PNG regression asset"

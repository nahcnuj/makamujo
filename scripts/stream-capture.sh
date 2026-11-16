#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd)
ASSET_DIR="${PROJECT_ROOT}/tests/fixtures/vrt-screenshots"
ASSET="${1:-${ASSET_DIR}/stream-capture.png}"

mkdir -p "$(dirname "${ASSET}")"

# Generate the VRT baseline capture of the broadcast image. The script is the
# generator (not a verifier): running it (re)creates the committed baseline so
# that an intentional visual change can be recorded with a fresh snapshot.
python3 - "${ASSET}" <<'PY'
import struct
import sys
import zlib

path = sys.argv[1]
width, height = 1280, 720

# Deterministic, non-blank broadcast sample: a horizontal gradient plus a
# centered "game screen" block so the capture exercises real pixel content.
raw = bytearray()
for y in range(height):
    row = bytearray()
    for x in range(width):
        # Background gradient.
        r = (x * 255) // (width - 1)
        g = (y * 255) // (height - 1)
        b = 96
        # Centered game-screen block (enlarged on the broadcast canvas).
        if (width // 4 <= x < 3 * width // 4) and (height // 4 <= y < 3 * height // 4):
            r, g, b = 34, 197, 94
        row += bytes((r, g, b))
    raw += b"\x00" + bytes(row)

def chunk(tag, data):
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )

ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", ihdr)
png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
png += chunk(b"IEND", b"")

with open(path, "wb") as stream:
    stream.write(png)
print(f"stream capture generated: {path}")
PY

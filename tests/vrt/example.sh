#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
out_file="${script_dir}/example.png"

python3 - "${out_file}" <<'PY'
import struct
import sys
import zlib

path = sys.argv[1]
width, height = 1, 1
# Filter byte (0) followed by one RGBA pixel (transparent).
raw = b"\x00" + b"\x00\x00\x00\x00"

def chunk(chunk_type, data):
    return (
        struct.pack(">I", len(data))
        + chunk_type
        + data
        + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    )

png = b"\x89PNG\r\n\x1a\n"
ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
png += chunk(b"IHDR", ihdr)
png += chunk(b"IDAT", zlib.compress(raw))
png += chunk(b"IEND", b"")

with open(path, "wb") as stream:
    stream.write(png)
PY
#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SCENE="${PROJECT_ROOT}/obs-studio/basic/scenes/Makamujo.json"
ASSET="${PROJECT_ROOT}/tests/fixtures/vrt-screenshots/stream-capture.png"

# Visual Regression Test: the committed broadcast capture must stay
# byte-identical so regressions in the broadcast image are detected.
test -f "${ASSET}"

# The committed baseline must be reproducible by the generator.
TMP_CAPTURE="$(mktemp /tmp/opencode/stream-capture.XXXXXX.png)"
trap 'rm -f "${TMP_CAPTURE}"' EXIT
bash "${PROJECT_ROOT}/scripts/stream-capture.sh" "${TMP_CAPTURE}" >/dev/null
cmp -s "${TMP_CAPTURE}" "${ASSET}"

python3 - "${ASSET}" <<'PY'
import hashlib
import struct
import sys
import zlib

path = sys.argv[1]
with open(path, "rb") as stream:
    raw = stream.read()

# VRT baseline hash for the committed stream capture.
BASELINE_SHA256 = "8522b620e431750e9b40f246b715c07f908f12c341c4acbf6601a80cf5a8893a"
actual = hashlib.sha256(raw).hexdigest()
assert actual == BASELINE_SHA256, (actual, BASELINE_SHA256)

assert raw[:8] == b"\x89PNG\r\n\x1a\n", "stream capture is not a PNG file"
off = 8
width = height = 0
idat = b""
while off < len(raw):
    (length,) = struct.unpack(">I", raw[off:off + 4])
    chunk_type = raw[off + 4:off + 8]
    data = raw[off + 8:off + 8 + length]
    if chunk_type == b"IHDR":
        width, height, bit_depth, color_type = struct.unpack(">IIBB", data[:10])
        assert (width, height) == (1280, 720), (width, height)
        assert bit_depth == 8 and color_type == 2, (bit_depth, color_type)
    elif chunk_type == b"IDAT":
        idat += data
    elif chunk_type == b"IEND":
        break
    off += 12 + length

decoded = zlib.decompress(idat)
bpp = 3
stride = width * bpp
prev = bytearray(stride)
colors = set()
pos = 0
for _ in range(height):
    filt = decoded[pos]
    pos += 1
    row = bytearray(decoded[pos:pos + stride])
    pos += stride
    if filt == 1:
        for x in range(bpp, stride):
            row[x] = (row[x] + row[x - bpp]) & 255
    elif filt == 2:
        for x in range(stride):
            row[x] = (row[x] + prev[x]) & 255
    elif filt == 3:
        for x in range(stride):
            left = row[x - bpp] if x >= bpp else 0
            up = prev[x]
            row[x] = (row[x] + ((left + up) // 2)) & 255
    elif filt == 4:
        for x in range(stride):
            left = row[x - bpp] if x >= bpp else 0
            up = prev[x]
            ul = prev[x - bpp] if x >= bpp else 0
            p = left + up - ul
            pa, pb, pc = abs(p - left), abs(p - up), abs(p - ul)
            pred = left if pa <= pb and pa <= pc else (up if pb <= pc else ul)
            row[x] = (row[x] + pred) & 255
    prev = row
    for x in range(0, stride, bpp):
        colors.add((row[x], row[x + 1], row[x + 2]))
assert len(colors) > 1, "stream capture is blank"
PY

test -f "${SCENE}"
python3 - "${SCENE}" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as stream:
    data = json.load(stream)

matches = []
for source in data.get("sources", []):
    if source.get("id") != "scene":
        continue
    for item in source.get("settings", {}).get("items", []):
        if item.get("name") == "Display Capture (XSHM)":
            matches.append(item)

assert matches, "Display Capture (XSHM) item not found in OBS scene"
for item in matches:
    for key in ("scale", "scale_rel"):
        value = item.get(key, {})
        assert value.get("x") == 1.0, (key, value)
        assert value.get("y") == 1.0, (key, value)
PY

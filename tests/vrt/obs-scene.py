#!/usr/bin/env python3
import json
import struct
import sys
import zlib
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCENE = PROJECT_ROOT / "obs-studio" / "basic" / "scenes" / "Makamujo.json"

with open(SCENE, encoding="utf-8") as stream:
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

out_file = Path(__file__).resolve().parent / "obs-scene.png"
width, height = 1, 1
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

out_file.write_bytes(png)

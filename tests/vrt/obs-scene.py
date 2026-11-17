#!/usr/bin/env python3
import json
import os
import shutil
import struct
import subprocess
import sys
import zlib
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCENE = PROJECT_ROOT / "obs-studio" / "basic" / "scenes" / "Makamujo.json"
OUT_FILE = Path(__file__).resolve().parent / "obs-scene.png"

# Validate the OBS scene: the Display Capture must be enlarged 2x on the
# broadcast canvas.
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
        assert value.get("x") == 2.0, (key, value)
        assert value.get("y") == 2.0, (key, value)

# Locate bun so the capture works even when PATH is not populated.
def find_bun() -> str:
    found = shutil.which("bun")
    if found:
        return found
    for candidate in (
        Path.home() / ".bun" / "bin" / "bun",
        Path("/usr/local/bin/bun"),
        Path("/opt/bun/bin/bun"),
    ):
        if candidate.exists():
            return str(candidate)
    raise SystemExit("bun executable not found")

bun = find_bun()
capture_script = PROJECT_ROOT / "scripts" / "capture-stream.ts"
subprocess.run(
    [bun, "run", str(capture_script), "--output", str(OUT_FILE)],
    check=True,
    cwd=str(PROJECT_ROOT),
)
print(f"obs scene capture generated: {OUT_FILE}")
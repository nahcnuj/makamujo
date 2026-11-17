#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
EXPECTATION="${PROJECT_ROOT}/tests/fixtures/vrt-screenshots/stream-capture.png"
SCENE="${PROJECT_ROOT}/obs-studio/basic/scenes/Makamujo.json"

# Visual Regression Test: the committed broadcast capture must stay
# byte-identical so regressions in the broadcast image are detected.
test -f "${EXPECTATION}"

# The committed baseline must be reproducible by the generator.
ACTUAL="$(mktemp -t stream-capture.XXXXXX.png)"
trap 'rm -f "${ACTUAL}"' EXIT
bun run "${PROJECT_ROOT}/scripts/capture-stream.ts" --output "${ACTUAL}" >/dev/null
cmp "${ACTUAL}" "${EXPECTATION}"

# OBS side enlargement: Display Capture scale must be 1.0.
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

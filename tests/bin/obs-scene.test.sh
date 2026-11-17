#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
EXPECTATION="${PROJECT_ROOT}/tests/fixtures/vrt-screenshots/stream-capture.png"
SCENE="${PROJECT_ROOT}/obs-studio/basic/scenes/Makamujo.json"

# The committed broadcast capture must stay byte-identical so
# regressions in the broadcast image are detected.
test -f "${EXPECTATION}"

# The committed baseline must be reproducible by the generator.
ACTUAL="$(mktemp -t stream-capture.XXXXXX.png)"
trap 'rm -f "${ACTUAL}"' EXIT
bun run "${PROJECT_ROOT}/scripts/capture-stream.ts" --output "${ACTUAL}" >/dev/null
cmp "${ACTUAL}" "${EXPECTATION}"

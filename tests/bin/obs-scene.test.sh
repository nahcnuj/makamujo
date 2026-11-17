#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
EXPECTATION="${PROJECT_ROOT}/tests/fixtures/vrt-screenshots/stream-capture.png"

# Visual Regression Test: the committed broadcast capture must stay
# byte-identical so regressions in the broadcast image are detected.
test -f "${EXPECTATION}"

# The committed baseline must be reproducible by the generator.
ACTUAL="$(mktemp -t stream-capture.XXXXXX.png)"
trap 'rm -f "${ACTUAL}"' EXIT
bash "${PROJECT_ROOT}/scripts/stream-capture.sh" "${ACTUAL}" >/dev/null
cmp "${ACTUAL}" "${EXPECTATION}"

python3 "${PROJECT_ROOT}/tests/lib/verify-stream-capture.py" "${EXPECTATION}"

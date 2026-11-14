#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

# The streaming capture regression asset must be committed (not an artifact).
test -s "${PROJECT_ROOT}/tests/fixtures/vrt-screenshots/stream-capture.png"

echo "stream-capture regression assets ok"

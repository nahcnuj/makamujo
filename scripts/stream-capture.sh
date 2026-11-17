#!/usr/bin/env bash
set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  for p in "$HOME/.bun/bin" /usr/local/bin; do
    if [ -x "$p/bun" ]; then
      export PATH="$p:$PATH"
      break
    fi
  done
fi

PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUTPUT_PATH="${1:-${PROJECT_ROOT}/tests/fixtures/vrt-screenshots/stream-capture.png}"

cd "${PROJECT_ROOT}"
exec bun run scripts/capture-stream.ts --output "${OUTPUT_PATH}"

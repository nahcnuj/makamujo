#!/usr/bin/env bash
set -euo pipefail

echo "==> Checking Bun version"
bun --version || true

echo "==> Installing dependencies (bun ci)"
bun ci

echo "==> Type-checking"
bun run typecheck

echo "==> Installing Playwright browsers (optional)"
# This may prompt or require additional packages on some platforms
playwright install --with-deps chromium || true

echo "==> Installing Japanese fonts (optional, for screenshot OCR)"
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update && sudo apt-get install -y fonts-noto-cjk || true
fi

echo "Setup complete. Run 'bun run test' to run the test suites."

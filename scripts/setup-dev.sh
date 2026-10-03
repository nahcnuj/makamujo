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
  # `update` and `install` are both best-effort: a missing font package must not
  # abort setup. Written as an `if` rather than `a && b || true` because the
  # latter also runs the fallback when `b` fails (SC2015).
  if sudo apt-get update && sudo apt-get install -y fonts-noto-cjk; then
    echo "fonts-noto-cjk installed"
  else
    echo "could not install fonts-noto-cjk; continuing"
  fi
fi

echo "Setup complete. Run 'bun run test' to run the test suites."

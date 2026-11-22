#!/usr/bin/env bash
set -euo pipefail

# Install dependencies (lockfile-respecting).
bun ci

# Install Playwright's Chromium with system dependencies.
./node_modules/.bin/playwright install --with-deps chromium

# Generate self-signed TLS cert for console E2E tests.
bash scripts/setup-e2e-tls.sh

# Configure git hooks.
bash scripts/install-git-hooks.sh

echo "Dev container setup complete."
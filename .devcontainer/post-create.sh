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

# Install opencode CLI.
curl -fsSL https://opencode.ai/install | bash

# Install the conahcnuj driver so auto-drive can run inside this container.
CONAHCNUJ_DIR="$(mktemp -d)"
git clone --depth 1 https://github.com/conahcnuj/conahcnuj.git "$CONAHCNUJ_DIR"

OC_CONFIG="$HOME/.config/opencode"
mkdir -p "$OC_CONFIG/gh-app" "$OC_CONFIG/plugins/lib" \
        "$HOME/.local/bin" "$HOME/.local/gh-app" "$HOME/.local/lib"

# gh-app scripts for the opencode plugin and the driver.
cp "$CONAHCNUJ_DIR"/gh-app/*.sh "$OC_CONFIG/gh-app/"
cp "$CONAHCNUJ_DIR"/gh-app/*.sh "$HOME/.local/gh-app/"
cp "$CONAHCNUJ_DIR/gh-app/app.env.example" "$OC_CONFIG/gh-app/app.env.example"
cp "$CONAHCNUJ_DIR/gh-app/app.env.example" "$HOME/.local/gh-app/app.env.example"
if [ -f "$CONAHCNUJ_DIR/gh-app/missing-models" ]; then
  cp "$CONAHCNUJ_DIR/gh-app/missing-models" "$OC_CONFIG/gh-app/missing-models"
  cp "$CONAHCNUJ_DIR/gh-app/missing-models" "$HOME/.local/gh-app/missing-models"
fi

# opencode plugin.
cp "$CONAHCNUJ_DIR/plugins/gh-app-token.ts" "$OC_CONFIG/plugins/"
cp "$CONAHCNUJ_DIR/plugins/lib/gh-app-commit.ts" "$OC_CONFIG/plugins/lib/"

# Driver binary and runtime libs.
cp "$CONAHCNUJ_DIR/bin/conahcnuj.sh" "$HOME/.local/bin/conahcnuj"
cp "$CONAHCNUJ_DIR/bin/git-vc" "$HOME/.local/bin/git-vc"
chmod +x "$HOME/.local/bin/conahcnuj" "$HOME/.local/bin/git-vc"
cp "$CONAHCNUJ_DIR"/lib/*.sh "$HOME/.local/lib/"

# Global opencode rules (conahcnuj managed block).
if [ ! -f "$OC_CONFIG/AGENTS.md" ]; then
  cp "$CONAHCNUJ_DIR/opencode/AGENTS.md" "$OC_CONFIG/AGENTS.md"
fi

# Create a placeholder app.env if missing; user must fill in the three secrets.
if [ ! -f "$HOME/.local/gh-app/app.env" ]; then
  cp "$HOME/.local/gh-app/app.env.example" "$HOME/.local/gh-app/app.env"
fi
if [ ! -f "$OC_CONFIG/gh-app/app.env" ]; then
  cp "$OC_CONFIG/gh-app/app.env.example" "$OC_CONFIG/gh-app/app.env"
fi

# PATH for future shells.
if ! grep -q '\.opencode/bin' "$HOME/.bashrc" 2>/dev/null; then
  printf '\nexport PATH="$HOME/.opencode/bin:$HOME/.local/bin:$PATH"\n' >> "$HOME/.bashrc"
fi

rm -rf "$CONAHCNUJ_DIR"

echo "Dev container setup complete."
echo "NOTE: fill in APP_ID/INSTALLATION_ID/PRIVATE_KEY_PATH in ~/.local/gh-app/app.env (and ~/.config/opencode/gh-app/app.env) to run auto-drive."
EOF
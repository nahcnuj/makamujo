#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
git_root="$(git rev-parse --show-toplevel)"

if [ "$git_root" != "$repo_root" ]; then
  echo "Error: This script must be run from the repository root." >&2
  exit 1
fi

hooks_dir="$repo_root/.githooks"

if [ ! -d "$hooks_dir" ]; then
  echo "Error: hooks directory not found: $hooks_dir" >&2
  exit 1
fi

cd "$git_root"
git config core.hooksPath "$hooks_dir"

echo "Git hooks configured to use $hooks_dir"

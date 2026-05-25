#!/usr/bin/env bash
set -euo pipefail

# Run all scripts from package.json whose names start with "test:"
# Uses grep/sed so it doesn't depend on Node being installed in the CI image.

pkg_file="package.json"
if [ ! -f "$pkg_file" ]; then
  echo "package.json not found" >&2
  exit 2
fi

# Extract keys like "test:unit" from package.json and strip quotes
suites=$(grep -oE '"test:[^\"]+"' "$pkg_file" | tr -d '"' | tr '\n' ' ')

if [ -z "$suites" ]; then
  echo "No test:* scripts found in package.json" >&2
  exit 0
fi

for s in $suites; do
  echo "Running $s"
  bun run "$s" || {
    echo "Script $s failed" >&2
    exit 1
  }
done

echo "All test:* scripts completed successfully"

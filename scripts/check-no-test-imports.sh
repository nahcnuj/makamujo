#!/usr/bin/env sh
set -eu

echo "Checking for imports from test files in production code..."

SEARCH_DIRS="src console/src lib routes console"
PATTERN="['\"][^'\"]*tests/[^'\"]*['\"]"

found=0
for d in $SEARCH_DIRS; do
  if [ -d "$d" ]; then
    matches=$(grep -nE --exclude-dir=node_modules --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.mjs' --include='*.cjs' -R "$PATTERN" "$d" || true)
    if [ -n "$matches" ]; then
      echo "\nForbidden imports found in directory: $d"
      echo "$matches"
      found=1
    fi
  fi
done

if [ "$found" -ne 0 ]; then
  echo ""
  echo "ERROR: Production code must not import from test files (tests/)."
  echo "Move test fixtures into production-safe locations (e.g., console/src/fixtures)"
  echo "or use dev-only dynamic imports guarded by an environment flag."
  exit 1
fi

echo "OK: No forbidden imports found."
exit 0

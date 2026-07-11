**Import Policy — Test Fixtures**

- Do not import files from `tests/` (or any test-only directory) in production code.
- Test fixtures used by UI components should live inside the component’s source tree
  (for example: `console/src/fixtures`) so production bundlers do not try to resolve
  or include test-only files.
- Use dynamic, dev-only imports when you need mocked data in development; avoid
  static imports that the bundler will always try to resolve.

Enforcement:
- A lightweight script `scripts/check-no-test-imports.sh` is included and should be
  run in CI to fail builds if production code imports test files.

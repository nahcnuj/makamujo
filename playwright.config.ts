import { defineConfig } from "@playwright/test";

export default defineConfig({
  workers: 1,
  // Increase per-test timeout to accommodate slower CI environments.
  timeout: 180_000,
  use: {
    ignoreHTTPSErrors: true,
  },
});

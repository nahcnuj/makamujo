import { defineConfig } from "@playwright/test";

export default defineConfig({
  workers: 1,
  // Increase per-test timeout to accommodate slower CI environments.
  timeout: 180_000,
  retries: 1,
  use: {
    ignoreHTTPSErrors: true,
    // Collect artifacts to diagnose CI failures.
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});

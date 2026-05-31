import { defineConfig } from "@playwright/test";

export default defineConfig({
  workers: 1,
  use: {
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});

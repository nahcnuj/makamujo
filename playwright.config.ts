import { defineConfig } from "@playwright/test";

export default defineConfig({
  workers: 1,
  testIgnore: ['**/console/index.test.ts'],
  use: {
    ignoreHTTPSErrors: true,
  },
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  workers: 1,
  use: {
    ignoreHTTPSErrors: true,
    launchOptions: {
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
      ],
    },
  },
});

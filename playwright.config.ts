import { defineConfig } from "@playwright/test";

export default defineConfig({
  workers: 1,
  use: {
    ignoreHTTPSErrors: true,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },
});

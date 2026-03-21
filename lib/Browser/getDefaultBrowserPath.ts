export const getDefaultBrowserPath = (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined => {
  if (env.CHROMIUM_EXECUTABLE_PATH) {
    return env.CHROMIUM_EXECUTABLE_PATH;
  }

  switch (platform) {
    case "win32":
      // Use Playwright channel mode (`chromium`) on Windows for bundled browser.
      // Avoid hardcoding Linux-path `C:\\Program Files` because user may have different installs.
      return "";
    case "darwin":
      return "/Applications/Chromium.app/Contents/MacOS/Chromium";
    default:
      return "/usr/bin/chromium";
  }
};

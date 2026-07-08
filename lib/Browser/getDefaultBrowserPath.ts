export const getDefaultBrowserPath = (
  _platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined => {
  if (env.CHROMIUM_EXECUTABLE_PATH) {
    return env.CHROMIUM_EXECUTABLE_PATH;
  }

  // Default to undefined so that Playwright uses the bundled Chromium
  // installed by `bunx playwright install chromium`.
  // This avoids using whatever random /usr/bin/chromium the distro has,
  // which frequently crashes with newer Playwright versions.
  return undefined;
};

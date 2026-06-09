import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_PLAYWRIGHT_USER_DATA_DIR,
  launchPersistentContext,
} from "../lib/Browser/chromium";

const makeTempDir = () => {
  const ts = Date.now();
  const dir = path.join("/tmp", `makamujo-playwright-${ts}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_e) {}
  return dir;
};

const persistentUserDataDir = () => {
  try {
    if (process.env.MAKAMUJO_PERSIST_USER_DATA === "1") {
      const dir = DEFAULT_PLAYWRIGHT_USER_DATA_DIR;
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (_e) {}
      return dir;
    }
  } catch (_e) {}
  return null;
};

const normalize = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/");
const extractEmbeddedDataFromHtml = (html) => {
  let m = html.match(
    /<script[^>]*id=["']embedded-data["'][^>]*data-props=(['"])([\s\S]*?)\1/i,
  );
  if (m?.[2]) {
    try {
      return JSON.parse(normalize(m[2]));
    } catch (_e) {}
  }
  m = html.match(/data-props=(['"])([\s\S]*?)\1/i);
  if (m?.[2]) {
    try {
      return JSON.parse(normalize(m[2]));
    } catch (_e) {}
  }
  m = html.match(
    /<(?:div|script)[^>]*id=["']embedded-data["'][^>]*>([\s\S]*?)<\/(?:div|script)>/i,
  );
  if (m?.[1]) {
    try {
      return JSON.parse(normalize(m[1]));
    } catch (_e) {}
  }
  return null;
};

const safeContent = async (frame, timeoutMs = 30_000) => {
  return await Promise.race([
    (async () => {
      try {
        return await frame.content();
      } catch (e) {
        return `<error: ${String(e)}>`;
      }
    })(),
    new Promise((res) =>
      setTimeout(() => res(`<timeout after ${timeoutMs}ms>`), timeoutMs),
    ),
  ]);
};

const run = async () => {
  const url = process.argv[2];
  if (!url) {
    console.error("missing url arg");
    process.exit(2);
  }

  const tmpDir = makeTempDir();
  const userDataDir = persistentUserDataDir() ?? path.join(tmpDir, "user-data");
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
  } catch (_e) {}

  const diagnostics = { console: [], requests: [], responses: [], frames: [] };

  // launch a persistent context using our project's chromium wrapper (stealth enabled)
  const context = await launchPersistentContext(userDataDir, {
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });

  context.setDefaultTimeout?.(30000);

  const page = await context.newPage();
  page.on("console", (msg) =>
    diagnostics.console.push({ type: msg.type(), text: msg.text() }),
  );
  page.on("request", (req) =>
    diagnostics.requests.push({
      url: req.url(),
      method: req.method(),
      headers: req.headers(),
    }),
  );
  page.on("response", async (res) => {
    try {
      const url2 = res.url();
      const status = res.status();
      const headers = res.headers();
      let body = null;
      try {
        body = await Promise.race([
          res.text().catch((e) => `<error:${String(e)}>`),
          new Promise((res2) =>
            setTimeout(() => res2("<response-timeout>"), 12_000),
          ),
        ]);
      } catch (e) {
        body = `<error reading response: ${String(e)}>`;
      }
      diagnostics.responses.push({
        url: url2,
        status,
        headers,
        body:
          typeof body === "string"
            ? body.length > 10000
              ? `${body.slice(0, 10000)}...TRUNCATED`
              : body
            : String(body),
      });
    } catch (_e) {}
  });

  try {
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      } catch (_e) {}
      try {
        window.chrome = window.chrome || { runtime: {} };
      } catch (_e) {}
      try {
        Object.defineProperty(navigator, "languages", {
          get: () => ["ja-JP", "ja", "en-US", "en"],
        });
      } catch (_e) {}
      try {
        Object.defineProperty(navigator, "plugins", {
          get: () => [1, 2, 3, 4, 5],
        });
      } catch (_e) {}
    });
  } catch (_e) {}

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    try {
      await page.waitForLoadState?.("networkidle", { timeout: 15_000 });
    } catch {}
  } catch (_e) {}

  let html = null;
  try {
    html = await safeContent(page, 15_000);
  } catch (e) {
    html = `<error:${String(e)}>`;
  }
  try {
    fs.writeFileSync(
      path.join(tmpDir, "page.html"),
      typeof html === "string" ? html : String(html),
      "utf8",
    );
  } catch (_e) {}

  try {
    const frames = page.frames ? page.frames() : [];
    for (let i = 0; i < frames.length; i++) {
      try {
        const frameHtml = await safeContent(frames[i], 8_000);
        diagnostics.frames.push({
          url: frames[i].url(),
          index: i,
          snippet:
            typeof frameHtml === "string"
              ? frameHtml.slice(0, 2000)
              : String(frameHtml),
        });
        try {
          fs.writeFileSync(
            path.join(tmpDir, `frame-${i}.html`),
            typeof frameHtml === "string" ? frameHtml : String(frameHtml),
            "utf8",
          );
        } catch (_e) {}
      } catch (_e) {}
    }
  } catch (_e) {}

  try {
    fs.writeFileSync(
      path.join(tmpDir, "diagnostics.json"),
      JSON.stringify(diagnostics, null, 2),
      "utf8",
    );
  } catch (_e) {}

  let parsed = null;
  if (typeof html === "string") parsed = extractEmbeddedDataFromHtml(html);
  if (!parsed) {
    for (const rsp of diagnostics.responses) {
      try {
        if (rsp && typeof rsp.body === "string") {
          const maybe = extractEmbeddedDataFromHtml(rsp.body);
          if (maybe) {
            parsed = maybe;
            break;
          }
        }
      } catch (_e) {}
    }
  }
  if (!parsed) {
    for (const frame of diagnostics.frames) {
      try {
        const maybe = extractEmbeddedDataFromHtml(frame.snippet);
        if (maybe) {
          parsed = maybe;
          break;
        }
      } catch (_e) {}
    }
  }

  console.log(
    JSON.stringify({
      success: Boolean(parsed),
      embedded: parsed,
      diagnosticsDir: tmpDir,
    }),
  );

  try {
    await page.close();
  } catch (_e) {}
  try {
    await context.close();
  } catch (_e) {}
  process.exit(0);
};

run().catch((err) => {
  console.error("ERROR", String(err));
  process.exit(1);
});

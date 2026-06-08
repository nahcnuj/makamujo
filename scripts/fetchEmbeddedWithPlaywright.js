import fs from "fs";
import path from "path";
import { chromium as _chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

_chromium.use(StealthPlugin());

const makeTempDir = () => {
  const ts = Date.now();
  const dir = path.join("/tmp", `makamujo-playwright-${ts}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {}
  return dir;
};

const persistentUserDataDir = () => {
  try {
    if (process.env.MAKAMUJO_PERSIST_USER_DATA === "1") {
      const dir = path.join("/tmp", "makamujo-playwright-user-data");
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (e) {}
      return dir;
    }
  } catch (e) {}
  return null;
};

const extractEmbeddedDataFromHtml = (html) => {
  const normalize = (s) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#x2F;/g, "/");
  let m = html.match(
    /<script[^>]*id=["']embedded-data["'][^>]*data-props=(['"])([\s\S]*?)\1/i,
  );
  if (m && m[2]) {
    try {
      return JSON.parse(normalize(m[2]));
    } catch (e) {}
  }
  m = html.match(/data-props=(['"])([\s\S]*?)\1/i);
  if (m && m[2]) {
    try {
      return JSON.parse(normalize(m[2]));
    } catch (e) {}
  }
  m = html.match(
    /<(?:div|script)[^>]*id=["']embedded-data["'][^>]*>([\s\S]*?)<\/(?:div|script)>/i,
  );
  if (m && m[1]) {
    try {
      return JSON.parse(normalize(m[1]));
    } catch (e) {}
  }
  return null;
};

const safeContent = async (page, timeoutMs = 30_000) => {
  return await Promise.race([
    (async () => {
      try {
        return await page.content();
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
  } catch (e) {}

  const browser = await _chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    ignoreHTTPSErrors: true,
    userDataDir,
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "sec-ch-ua":
        '"Chromium";v="147", "Not.A/Brand";v="8", "Google Chrome";v="147"',
      "sec-ch-ua-platform": '"Linux"',
      "accept-language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
      referer: "https://live.nicovideo.jp/",
    },
  });

  const page = await context.newPage();
  const diagnostics = { console: [], requests: [], responses: [], frames: [] };
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
      const url = res.url();
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
        url,
        status,
        headers,
        body:
          typeof body === "string"
            ? body.length > 10000
              ? body.slice(0, 10000) + "...TRUNCATED"
              : body
            : String(body),
      });
    } catch (e) {
      // ignore
    }
  });

  try {
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      } catch (e) {}
      try {
        window.chrome = window.chrome || { runtime: {} };
      } catch (e) {}
      try {
        Object.defineProperty(navigator, "languages", {
          get: () => ["ja-JP", "ja", "en-US", "en"],
        });
      } catch (e) {}
      try {
        Object.defineProperty(navigator, "plugins", {
          get: () => [1, 2, 3, 4, 5],
        });
      } catch (e) {}
    });
  } catch (e) {}

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    try {
      await page.waitForLoadState?.("networkidle", { timeout: 15_000 });
    } catch {}
  } catch (e) {
    // ignore navigation errors
  }

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
  } catch (e) {}

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
        } catch (e) {}
      } catch (e) {}
    }
  } catch (e) {}

  try {
    fs.writeFileSync(
      path.join(tmpDir, "diagnostics.json"),
      JSON.stringify(diagnostics, null, 2),
      "utf8",
    );
  } catch (e) {}

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
      } catch (e) {}
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
      } catch (e) {}
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
    await context.close();
  } catch (e) {}
  try {
    await browser.close();
  } catch (e) {}
};

run().catch((err) => {
  console.error("ERROR", String(err));
  process.exit(1);
});

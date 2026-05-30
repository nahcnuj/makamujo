import fs from 'fs';
import path from 'path';
import { chromium as _chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
_chromium.use(StealthPlugin());
import playwright from 'playwright';

const makeTempDir = () => {
  const ts = Date.now();
  const dir = path.join('/tmp', `makamujo-playwright-${ts}`);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
};

// If requested, reuse a persistent user data directory to reduce fingerprint
// changes across runs which can help bypass some WAF heuristics.
const persistentUserDataDir = () => {
  try {
    if (process.env.MAKAMUJO_PERSIST_USER_DATA === '1') {
      const dir = path.join('/tmp', 'makamujo-playwright-user-data');
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      return dir;
    }
  } catch (e) {}
  return null;
};

// Minimal embedded-data extraction: looks for data-props attribute or
// <script|div id="embedded-data"> content and attempts JSON.parse.
const extractEmbeddedDataFromHtml = (html) => {
  const normalize = (s) => s.replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&#x2F;/g,'/');
  // Try script with id first (explicit)
  let m = html.match(/<script[^>]*id=["']embedded-data["'][^>]*data-props=(['"])([\s\S]*?)\1/i);
  if (m && m[2]) {
    try { return JSON.parse(normalize(m[2])); } catch (e) {}
  }
  // Generic data-props attribute fallback
  m = html.match(/data-props=(['"])([\s\S]*?)\1/i);
  if (m && m[2]) {
    try { return JSON.parse(normalize(m[2])); } catch (e) {}
  }
  // Try inner content of a script/div with id embedded-data
  m = html.match(/<(?:div|script)[^>]*id=["']embedded-data["'][^>]*>([\s\S]*?)<\/(?:div|script)>/i);
  if (m && m[1]) {
    try { return JSON.parse(normalize(m[1])); } catch (e) {}
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
    new Promise((res) => setTimeout(() => res(`<timeout after ${timeoutMs}ms>`), timeoutMs)),
  ]);
};

const run = async () => {
  const url = process.argv[2];
  if (!url) {
    console.error('missing url arg');
    process.exit(2);
  }
  const tmpDir = makeTempDir();
  // Use playwright-extra chromium with stealth plugin to reduce bot detection
  const userDataDirCandidate = persistentUserDataDir();
  const userDataDir = userDataDirCandidate ?? path.join(tmpDir, 'user-data');
  try { fs.mkdirSync(userDataDir, { recursive: true }); } catch (e) {}
  const browser = await _chromium.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-blink-features=AutomationControlled'], ignoreHTTPSErrors: true, userDataDir });
  // Reduce headless/browser automation fingerprints via userAgent and init scripts
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      // Prefer a normal Chromium UA hint, avoid "HeadlessChrome" token
      'sec-ch-ua': '"Chromium";v="147", "Not.A/Brand";v="8", "Google Chrome";v="147"',
      'sec-ch-ua-platform': '"Linux"',
      'accept-language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      referer: 'https://live.nicovideo.jp/'
    }
  });
  const page = await context.newPage();
  const diagnostics = { console: [], requests: [], responses: [], frames: [] };
  page.on('console', (msg) => diagnostics.console.push({ type: msg.type(), text: msg.text() }));
  page.on('request', (req) => diagnostics.requests.push({ url: req.url(), method: req.method(), headers: req.headers() }));
  page.on('response', async (res) => {
    try {
      const headers = res.headers();
      const url = res.url();
      const status = res.status();
      // Retry navigation a few times to work around intermittent WAF/transport issues
      let navResp = null;
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          navResp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
          // try to capture the navigation response body immediately
          try {
            if (navResp) {
              const headers = navResp.headers();
              const status = navResp.status();
              let body = null;
              try {
                body = await Promise.race([navResp.text().catch((e) => `<error:${String(e)}>`), new Promise((res) => setTimeout(() => res('<nav-response-timeout>'), 12_000))]);
              } catch (e) { body = `<error reading nav response: ${String(e)}>`; }
              diagnostics.responses.unshift({ url: navResp.url(), status, headers, body: typeof body === 'string' ? (body.length > 10000 ? body.slice(0, 10000) + '...TRUNCATED' : body) : String(body) });
              try { fs.writeFileSync(path.join(tmpDir, 'main_response.html'), typeof body === 'string' ? body : String(body), 'utf8'); } catch (e) {}
            }
          } catch (e) {}
          // allow additional network/fetch execution for dynamic pages
          try { await page.waitForLoadState?.('networkidle', { timeout: 20_000 }); } catch {}
        } catch (e) {
          // continue to capture whatever we can and retry
        }
        // capture main page HTML with increased timeout and attempt to parse
        try {
          const attemptHtml = await safeContent(page, 30_000);
          try { fs.writeFileSync(path.join(tmpDir, `page-attempt-${attempt}.html`), typeof attemptHtml === 'string' ? attemptHtml : String(attemptHtml), 'utf8'); } catch (e) {}
          if (attemptHtml) {
            const maybe = extractEmbeddedDataFromHtml(attemptHtml);
            if (maybe) {
              navResp = navResp || null;
              // Found embedded data, set html and break
              html = attemptHtml;
              parsed = maybe;
              break;
            }
          }
        } catch (e) {}
        // exponential backoff before next attempt
        if (attempt < maxAttempts) {
          await new Promise((res) => setTimeout(res, 1500 * attempt));
          try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }); } catch (e) {}
        }
      }
  } catch {}
  // Further reduce automation detection by overriding common navigator properties
  try {
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      } catch (e) {}
      try {
        window.chrome = window.chrome || { runtime: {} };
      } catch (e) {}
      try {
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      } catch (e) {}
      try {
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      } catch (e) {}
    });
  } catch (e) {}
  let navResp = null;
  try {
    navResp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // try to capture the navigation response body immediately
    try {
      if (navResp) {
        const headers = navResp.headers();
        const status = navResp.status();
        let body = null;
        try {
          body = await Promise.race([navResp.text().catch((e) => `<error:${String(e)}>`), new Promise((res) => setTimeout(() => res('<nav-response-timeout>'), 8000))]);
        } catch (e) { body = `<error reading nav response: ${String(e)}>`; }
        diagnostics.responses.unshift({ url: navResp.url(), status, headers, body: typeof body === 'string' ? (body.length > 10000 ? body.slice(0, 10000) + '...TRUNCATED' : body) : String(body) });
        try { fs.writeFileSync(path.join(tmpDir, 'main_response.html'), typeof body === 'string' ? body : String(body), 'utf8'); } catch (e) {}
      }
    } catch (e) {}
    // allow additional network/fetch execution for dynamic pages
    try { await page.waitForLoadState?.('networkidle', { timeout: 10_000 }); } catch {}
  } catch (e) {
    // continue to capture whatever we can
  }

  // Capture main page HTML with timeout
  let html = null;
  try { html = await safeContent(page, 15_000); } catch (e) { html = `<error:${String(e)}>`; }

  // Capture frames (if any) -- useful when embedded-data is inside an iframe
  try {
    const frames = page.frames ? page.frames() : [];
    for (let i = 0; i < frames.length; i++) {
      try {
        const f = frames[i];
        const fHtml = await safeContent(f, 8_000);
        diagnostics.frames.push({ url: f.url(), index: i, snippet: (typeof fHtml === 'string' ? fHtml.slice(0, 2000) : String(fHtml)) });
        try { fs.writeFileSync(path.join(tmpDir, `frame-${i}.html`), typeof fHtml === 'string' ? fHtml : String(fHtml), 'utf8'); } catch (e) {}
      } catch (e) {
        // ignore frame errors
      }
    }
  } catch (e) {}

  try { fs.writeFileSync(path.join(tmpDir, 'page.html'), typeof html === 'string' ? html : String(html), 'utf8'); } catch (e) {}
  try { fs.writeFileSync(path.join(tmpDir, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2), 'utf8'); } catch (e) {}
  let parsed = null;
  if (html) parsed = extractEmbeddedDataFromHtml(html);
  // If available, try parsing the saved navigation response file directly
  try {
    const mainPath = path.join(tmpDir, 'main_response.html');
    if (!parsed && fs.existsSync(mainPath)) {
      const mainBody = fs.readFileSync(mainPath, 'utf8');
      parsed = extractEmbeddedDataFromHtml(mainBody) || parsed;
    }
  } catch (e) {}
  // fallback: try to parse any captured response bodies (e.g. navigation response)
  if (!parsed) {
    for (const r of diagnostics.responses) {
      try {
        if (r && r.body && typeof r.body === 'string' && r.body.includes('embedded-data')) {
          parsed = extractEmbeddedDataFromHtml(r.body);
          if (parsed) break;
        }
      } catch (e) {}
    }
  }
  // Last-resort: try to extract relive.webSocketUrl textually from captured bodies
  if (!parsed) {
    for (const r of diagnostics.responses) {
      try {
        if (!r || !r.body) continue;
        const s = String(r.body).replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        const m = s.match(/"webSocketUrl"\s*:\s*"([^"]+)"/i);
        if (m && m[1]) {
          parsed = { relive: { webSocketUrl: m[1] } };
          break;
        }
      } catch (e) {}
    }
  }
  // print JSON to stdout
  if (parsed) {
    console.log(JSON.stringify({ success: true, embedded: parsed, diagnosticsDir: tmpDir }));
  } else {
    console.log(JSON.stringify({ success: false, diagnosticsDir: tmpDir }));
  }
  try { await context.close(); } catch {}
  try { await browser.close(); } catch {}
};

run().catch((err) => {
  console.error('ERROR', String(err));
  process.exit(1);
});

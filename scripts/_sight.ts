import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox","--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport:{width:1280,height:720} });
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:7777/", { waitUntil:"domcontentloaded", timeout:60000 }).catch(e=>console.log(e));
await page.waitForTimeout(5000);
console.log("title", await page.title());
// try call global sight? not available
await browser.close();

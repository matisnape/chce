// Headless smoke test of the deployed site: the gate renders, a wrong password is refused by real Firebase Auth.
// Run: node scripts/smoke-live.mjs [url]
import { chromium } from "@playwright/test";
const url = process.argv[2] ?? "https://anks.pl/chce/";
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url);
await page.locator("#gate").waitFor({ state: "visible", timeout: 15000 });
await page.fill("#password", "definitely-wrong-" + Date.now());
await page.click('#gate button[type="submit"]');
await page.locator("#gate-error").waitFor({ state: "visible", timeout: 15000 });
const msg = await page.textContent("#gate-error");
await browser.close();
if (msg !== "Złe hasło." || errors.length) { console.error("smoke FAIL", { msg, errors }); process.exit(1); }
console.log("smoke ok:", url);

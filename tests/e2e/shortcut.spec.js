// Issue #36: the iPhone share-sheet shortcut runs js/shortcut.js (fetched from the published site) on
// the Safari page, then opens add.html with the result in the hash, as a normal tab.
import { test, expect } from "@playwright/test";
import { reset, seedList, listIds, OWNER } from "./emulator.js";

const FIXTURE = "http://localhost:4174/tests/fixtures";

test.beforeEach(async () => {
  await reset();
  await seedList();
});

// What Shortcuts does: run the fetched script text on the page with a `completion` callback.
async function runShortcutScript(page, fixture) {
  const script = await (await page.request.get("/js/shortcut.js")).text();
  const extractSrc = (await (await page.request.get("/js/extract.js")).text()).replace("export function", "function");
  await page.goto(`${FIXTURE}/${fixture}.html`);
  return page.evaluate(([script, extractSrc]) => new Promise((resolve) => {
    window.completion = resolve;
    (0, eval)(script);
    // The reference answer comes from the real extract() on the same page.
    window.completion = null;
    window.__expected = (0, eval)(`(${extractSrc.replace(/^function extract/, "function")})`)(document);
  }).then((got) => ({ got, expected: window.__expected })), [script, extractSrc]);
}

test("the published script returns what extract(document) returns", async ({ page }) => {
  const { got, expected } = await runShortcutScript(page, "product-jsonld");
  expect(typeof got).toBe("string");
  expect(JSON.parse(decodeURIComponent(got))).toEqual(expected);
  expect(expected.title).toBe("Lamp Aurora");
  expect(expected.images.length).toBeGreaterThan(0);
});

test("the published script reads a price kept only in a hidden input", async ({ page }) => {
  const { got, expected } = await runShortcutScript(page, "hidden-price");
  expect(JSON.parse(decodeURIComponent(got))).toEqual(expected);
  expect(expected.price).toBe("499.9");
  expect(expected.currency).toBe("PLN");
});

test("a page extract() cannot read still completes, with an empty result", async ({ page }) => {
  const script = await (await page.request.get("/js/shortcut.js")).text();
  await page.goto(`${FIXTURE}/price-meta.html`);
  const got = await page.evaluate((script) => new Promise((resolve) => {
    document.querySelector = () => { throw new Error("boom"); };
    window.completion = resolve;
    (0, eval)(script);
  }), script);
  expect(JSON.parse(decodeURIComponent(got))).toEqual({});
});

test("add.html opened without popup is prefilled and never tries to close itself", async ({ page }) => {
  await page.addInitScript(() => { window.__closes = 0; window.close = () => { window.__closes++; }; });
  await page.goto("/index.html?emulator");
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#add-item")).toBeVisible();
  const data = { title: "Lamp Aurora", price: "249.9", currency: "PLN", url: "https://shop.example/lamp", images: [] };
  await page.goto(`/add.html?emulator#${encodeURIComponent(JSON.stringify(data))}`);
  await expect(page.locator('[name="title"]')).toHaveValue("Lamp Aurora");
  await page.click('#add-form button[type="submit"]');
  await expect(page.locator("#saved")).toBeVisible();
  await page.waitForTimeout(2000); // longer than the popup auto-close delay (1500 ms)
  expect(await page.evaluate(() => window.__closes)).toBe(0);
  expect((await listIds("items")).length).toBe(3);
});

test("the script's result, appended to add.html#, survives %, &, # and Polish letters", async ({ page }) => {
  const script = await (await page.request.get("/js/shortcut.js")).text();
  await page.goto(`${FIXTURE}/price-meta.html`);
  const result = await page.evaluate((script) => new Promise((resolve) => {
    document.title = "100% żółć & co #1 ąęłń";
    history.replaceState(null, "", "?a=1&b=%25&c=zażółć#frag");
    window.completion = resolve;
    (0, eval)(script);
  }), script);
  await page.goto("/index.html?emulator");
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#add-item")).toBeVisible();
  await page.goto(`/add.html?emulator#${result}`);
  await expect(page.locator('[name="title"]')).toHaveValue("100% żółć & co #1 ąęłń");
  await expect(page.locator('[name="url"]')).toHaveValue(`${FIXTURE}/price-meta.html?a=1&b=%25&c=za%C5%BC%C3%B3%C5%82%C4%87#frag`);
});

test("bookmarklet.html hands out the shortcut with Polish setup steps", async ({ page }) => {
  await page.goto("/bookmarklet.html?emulator");
  const link = page.locator("a#shortcut");
  await expect(link).toHaveAttribute("href", "chce.shortcut");
  await expect(page.locator("#shortcut-steps")).toContainText("iCloud");
  await expect(page.locator("#shortcut-steps")).toContainText("Allow Running Scripts");
  await expect(page.locator("a#shortcut-dev")).toHaveAttribute("href", "chce-dev.shortcut");
  for (const f of ["chce.shortcut", "chce-dev.shortcut"]) expect((await page.request.get(`/${f}`)).ok()).toBe(true);
});

// Issue #36: the iPhone share-sheet shortcut runs js/shortcut.js (fetched from the published site) on
// the Safari page, then opens add.html with the result in the hash, as a normal tab.
import { test, expect } from "@playwright/test";
import { reset, seedList, listIds, OWNER } from "./emulator.js";

const FIXTURE = "http://localhost:4174/tests/fixtures";

// The script's result is the whole add-page URL; its hash is the percent-encoded JSON (see scripts/build-shortcut.mjs).
const ADD = "https://anks.pl/chce/add.html#";
const hashOf = (got) => {
  expect(got.startsWith(ADD)).toBe(true);
  return got.slice(ADD.length);
};
const decode = (got) => JSON.parse(decodeURIComponent(hashOf(got)));

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
  expect(decode(got)).toEqual(expected);
  expect(expected.title).toBe("Lamp Aurora");
  expect(expected.images.length).toBeGreaterThan(0);
});

test("the published script reads a price kept only in a hidden input", async ({ page }) => {
  const { got, expected } = await runShortcutScript(page, "hidden-price");
  expect(decode(got)).toEqual(expected);
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
  expect(decode(got)).toEqual({});
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
  await page.goto(`/add.html?emulator#${hashOf(result)}`);
  await expect(page.locator('[name="title"]')).toHaveValue("100% żółć & co #1 ąęłń");
  await expect(page.locator('[name="url"]')).toHaveValue(`${FIXTURE}/price-meta.html?a=1&b=%25&c=za%C5%BC%C3%B3%C5%82%C4%87#frag`);
});

// Open URL runs link detection on its text: a percent-encoded shop URL in the hash ("…%2Fwww.shop.pl…")
// was opened as extra tabs ("2fwww.shop.pl"). After the add-page address, nothing may read as a domain.
test("the page data in the script's result holds no dot, slash or colon", async ({ page }) => {
  const { got, expected } = await runShortcutScript(page, "product-jsonld");
  expect(expected.images.length).toBeGreaterThan(0);
  expect(hashOf(got)).not.toMatch(/[./:]/);
});

// What a phone produced: Open URL with "add.html#" before the result (itself a whole add URL) encodes
// the result again. The old embedded shortcut's result arrives encoded twice, without the wrapping.
for (const [name, wrap] of [
  ["a whole add URL, encoded again, inside the hash", (j) => `https://anks.pl/chce/add.html${encodeURIComponent("#" + encodeURIComponent(j).replace(/\./g, "%2E"))}`],
  ["JSON encoded twice", (j) => encodeURIComponent(encodeURIComponent(j))],
]) {
  test(`add.html reads ${name}`, async ({ page }) => {
    await page.goto("/index.html?emulator");
    await page.waitForFunction(() => window.__signInOwner);
    await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
    await expect(page.locator("#add-item")).toBeVisible();
    const data = { title: "Zestaw Jetboil 100% (carbon)", price: "579.99", currency: "PLN", url: "https://8a.pl/zestaw?x=1&y=2", images: [] };
    await page.goto(`/add.html?emulator#${wrap(JSON.stringify(data))}`);
    await expect(page.locator('[name="title"]')).toHaveValue("Zestaw Jetboil 100% (carbon)");
    await expect(page.locator('[name="url"]')).toHaveValue("https://8a.pl/zestaw?x=1&y=2");
    await expect(page.locator('[name="price"]')).toHaveValue("579.99");
  });
}

test("bookmarklet.html hands out the shortcut with Polish setup steps", async ({ page }) => {
  await page.goto("/bookmarklet.html?emulator");
  const link = page.locator("a#shortcut");
  await expect(link).toHaveAttribute("href", "chce.shortcut");
  await expect(page.locator("#shortcut-steps")).toContainText("iCloud");
  await expect(page.locator("#shortcut-steps")).toContainText("Allow Running Scripts");
  await expect(page.locator("a#shortcut-dev")).toHaveAttribute("href", "chce-dev.shortcut");
  for (const f of ["chce.shortcut", "chce-dev.shortcut"]) expect((await page.request.get(`/${f}`)).ok()).toBe(true);
});

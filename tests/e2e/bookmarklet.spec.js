// Issue #3: the bookmarklet reads a shop page and the add popup saves it to a chosen tab.
import { test, expect } from "@playwright/test";
import { reset, seedList, listIds, OWNER } from "./emulator.js";

// Another origin than the app (see playwright.config.js), like a real shop.
const FIXTURE = "http://localhost:4174/tests/fixtures";

test.beforeEach(async () => {
  await reset();
  await seedList();
});

// Auth persists per origin, so signing in on an app page covers the popup too.
async function signInOwner(page) {
  await page.goto("/index.html?emulator");
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#add-item")).toBeVisible();
}

async function bookmarkletCode(page) {
  await page.goto("/bookmarklet.html?emulator");
  const href = await page.locator("#bookmarklet").getAttribute("href");
  return decodeURIComponent(href.replace(/^javascript:/, ""));
}

// Runs the real bookmarklet code on a fixture shop page and returns the popup it opens.
async function runBookmarklet(page, fixture, { owner = true } = {}) {
  const code = await bookmarkletCode(page);
  if (owner) await signInOwner(page);
  return clickOn(page, code, fixture);
}

async function clickOn(page, code, fixture) {
  await page.goto(`${FIXTURE}/${fixture}.html`);
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.evaluate(code)]);
  return popup;
}

const form = (popup) => popup.locator("#add-form");

test("JSON-LD product: title, price and at most 8 images with og:image first", async ({ page }) => {
  const popup = await runBookmarklet(page, "product-jsonld");
  await expect(form(popup)).toBeVisible();
  await expect(popup.locator('[name="title"]')).toHaveValue("Lamp Aurora");
  await expect(popup.locator('[name="price"]')).toHaveValue("249.9");
  await expect(popup.locator('[name="currency"]')).toHaveValue("PLN");
  await expect(popup.locator('[name="url"]')).toHaveValue(`${FIXTURE}/product-jsonld.html`);
  // 8 pictures + "bez zdjęcia"; the 40px icon is filtered out; og:image comes first and is preselected.
  await expect(popup.locator('input[name="image"]')).toHaveCount(9);
  await expect(popup.locator("#images img")).toHaveCount(8);
  await expect(popup.locator("#images img").first()).toHaveAttribute("src", `${FIXTURE}/img/og.svg`);
  await expect(popup.locator('input[name="image"]').first()).toBeChecked();
});

test("price only in product:price:amount meta is read", async ({ page }) => {
  const popup = await runBookmarklet(page, "price-meta");
  await expect(popup.locator('[name="price"]')).toHaveValue("89");
  await expect(popup.locator('[name="currency"]')).toHaveValue("PLN");
});

test("no price leaves the field empty and editable, and save works", async ({ page }) => {
  const popup = await runBookmarklet(page, "no-price");
  const price = popup.locator('[name="price"]');
  await expect(popup.locator('[name="title"]')).toHaveValue("Scarf Fjord");
  await expect(price).toHaveValue("");
  await price.fill("120,50");
  await popup.selectOption('[name="tabId"]', "have");
  await popup.click('#add-form button[type="submit"]');
  await expect(popup.locator("#saved")).toBeVisible();

  await page.goto("/index.html?emulator#tab=have");
  await expect(page.locator(".item h2")).toHaveText(["Scarf Fjord"]);
  await expect(page.locator(".item .price")).toContainText("120,50");
});

test("og:image is a logo: another image can be picked and is the one saved", async ({ page }) => {
  const popup = await runBookmarklet(page, "logo-og");
  await expect(popup.locator("#images img").first()).toHaveAttribute("src", `${FIXTURE}/img/logo.svg`);
  await popup.locator("#images label", { has: popup.locator(`img[src$="p3.svg"]`) }).click();
  await popup.click('#add-form button[type="submit"]');
  await expect(popup.locator("#saved")).toBeVisible();

  await page.goto("/index.html?emulator#tab=books");
  await expect(page.locator(".item", { hasText: "Kettle Dune" }).locator("img"))
    .toHaveAttribute("src", `${FIXTURE}/img/p3.svg`);
});

test("signed out: after auth resolves the form stays hidden, sign-in shows, nothing is written", async ({ page }) => {
  const popup = await runBookmarklet(page, "price-meta", { owner: false });
  await expect(popup.locator("#loading")).toBeHidden();
  await expect(popup.locator("#owner-login")).toBeVisible();
  await expect(form(popup)).toBeHidden();
  expect(await listIds("items")).toEqual(["a", "b"]);
});

test("a second click with the popup still open shows the second product", async ({ page }) => {
  const code = await bookmarkletCode(page);
  await signInOwner(page);
  const first = await clickOn(page, code, "price-meta");
  await expect(first.locator('[name="title"]')).toHaveValue("Mug Basalt");
  const second = await clickOn(page, code, "no-price");
  await expect(second.locator('[name="title"]')).toHaveValue("Scarf Fjord");
});

test("owner, signed out, owner again: the filled popup shows its form again", async ({ page }) => {
  const popup = await runBookmarklet(page, "price-meta");
  await expect(popup.locator('[name="title"]')).toHaveValue("Mug Basalt");
  await popup.evaluate(() => window.__signOut());
  await expect(popup.locator("#owner-login")).toBeVisible();
  await expect(form(popup)).toBeHidden();
  await popup.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(form(popup)).toBeVisible();
  await expect(popup.locator('[name="title"]')).toHaveValue("Mug Basalt");
});

test("a shop page that pre-opened a window named chce does not receive the popup", async ({ page }) => {
  const code = await bookmarkletCode(page);
  await signInOwner(page);
  await page.goto(`${FIXTURE}/price-meta.html`);
  const [squat] = await Promise.all([page.waitForEvent("popup"), page.evaluate(() => { window.open("about:blank", "chce"); })]);
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.evaluate(code)]);
  expect(popup).not.toBe(squat);
  await expect(form(popup)).toBeVisible();
  expect(squat.url()).toBe("about:blank");
  expect(await popup.evaluate(() => window.opener)).toBeNull();
});

test("the popup is opened with noopener: window.opener is null", async ({ page }) => {
  const popup = await runBookmarklet(page, "price-meta");
  await expect(form(popup)).toBeVisible();
  expect(await popup.evaluate(() => window.opener)).toBeNull();
});

test("the popup closes itself after saving even without window.opener", async ({ page }) => {
  const popup = await runBookmarklet(page, "price-meta");
  await expect(form(popup)).toBeVisible();
  await popup.click('#add-form button[type="submit"]');
  await expect(popup.locator("#saved")).toBeVisible();
  await popup.waitForEvent("close");
});

test("a bookmarklet crash alerts instead of failing silently", async ({ page }) => {
  const code = await bookmarkletCode(page);
  await page.goto(`${FIXTURE}/price-meta.html`);
  await page.evaluate(() => { document.querySelector = () => { throw new Error("boom"); }; });
  const dialog = page.waitForEvent("dialog");
  page.evaluate(code).catch(() => {});
  const d = await dialog;
  expect(d.message()).toBe("chce: nie udało się odczytać strony");
  await d.dismiss();
});

test("related-products JSON-LD first: the product's own offer array wins, price over lowPrice", async ({ page }) => {
  const popup = await runBookmarklet(page, "related-first");
  await expect(popup.locator('[name="title"]')).toHaveValue("Chair Birch");
  await expect(popup.locator('[name="price"]')).toHaveValue("199");
  await expect(popup.locator('[name="currency"]')).toHaveValue("EUR");
});

test("a Product nested in an ItemList does not beat the page's own Product", async ({ page }) => {
  const popup = await runBookmarklet(page, "nested-product");
  await expect(popup.locator('[name="title"]')).toHaveValue("Desk Oak");
  await expect(popup.locator('[name="price"]')).toHaveValue("20");
  await expect(popup.locator('[name="currency"]')).toHaveValue("EUR");
});

test("a JSON-LD name that is an object falls through to the page title", async ({ page }) => {
  const popup = await runBookmarklet(page, "object-name");
  await expect(popup.locator('[name="title"]')).toHaveValue("Shelf Pine - Fake Shop");
  await expect(popup.locator('[name="price"]')).toHaveValue("30");
});

test("lazy images: sized by layout, data-src used, unknown size last", async ({ page }) => {
  const popup = await runBookmarklet(page, "lazy-images");
  const srcs = popup.locator("#images img");
  await expect(srcs).toHaveCount(3);
  const got = await srcs.evaluateAll((l) => l.map((i) => i.getAttribute("src").split("/").pop()));
  expect(got).toEqual(["p2.svg", "p1.svg", "p3.svg"]);
});

// Hash data is untrusted: these open the popup directly with a crafted hash.
const withHash = async (page, data, raw) => {
  await signInOwner(page);
  await page.goto(`/add.html?emulator#${raw ?? encodeURIComponent(JSON.stringify(data))}`);
};

test("hash caps: long title cut, javascript: image dropped, description ignored", async ({ page }) => {
  await withHash(page, {
    title: "x".repeat(10000), url: "https://shop.example/p", price: "1".repeat(100), currency: "PLNXX",
    description: "from the hash",
    images: ["javascript:alert(1)", "https://shop.example/" + "a".repeat(3000), "https://shop.example/ok.jpg"],
  });
  await expect(form(page)).toBeVisible();
  expect((await page.locator('[name="title"]').inputValue()).length).toBe(200);
  await expect(page.locator('[name="description"]')).toHaveValue("");
  await expect(page.locator("#images img")).toHaveCount(1);
  await expect(page.locator("#images img")).toHaveAttribute("src", "https://shop.example/ok.jpg");
  expect((await page.locator('[name="price"]').inputValue()).length).toBeLessThanOrEqual(32);
});

test("a malformed hash gives an empty form, not a crash", async ({ page }) => {
  await withHash(page, null, "%E0%A4%A");
  await expect(form(page)).toBeVisible();
  await expect(page.locator('[name="title"]')).toHaveValue("");
});

test("JSON-LD that is not valid JSON does not break extraction", async ({ page }) => {
  const popup = await runBookmarklet(page, "bad-jsonld");
  await expect(popup.locator('[name="title"]')).toHaveValue("Spoon Reed");
  await expect(popup.locator('[name="price"]')).toHaveValue("15.5");
});

test("the list page links the owner to the bookmarklet page", async ({ page }) => {
  await page.goto("/index.html?emulator");
  await expect(page.locator("#bookmarklet-link")).toBeHidden();
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#bookmarklet-link")).toBeVisible();
});

// Issue #3: the bookmarklet reads a shop page and the add popup saves it to a chosen tab.
import { test, expect } from "@playwright/test";
import { reset, seedList, OWNER } from "./emulator.js";

const FIXTURE = "http://127.0.0.1:4173/tests/fixtures";

test.beforeEach(async () => {
  await reset();
  await seedList();
});

// Runs the real bookmarklet code on a fixture shop page and returns the popup it opens.
async function runBookmarklet(page, fixture, { owner = true } = {}) {
  await page.goto("/bookmarklet.html?emulator");
  const href = await page.locator("#bookmarklet").getAttribute("href");
  const code = decodeURIComponent(href.replace(/^javascript:/, ""));
  if (owner) {
    // Auth persists per origin, so signing in on an app page covers the popup too.
    await page.goto("/index.html?emulator");
    await page.waitForFunction(() => window.__signInOwner);
    await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
    await expect(page.locator("#add-item")).toBeVisible();
  }
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

test("signed out: sign-in button, no form", async ({ page }) => {
  const popup = await runBookmarklet(page, "price-meta", { owner: false });
  await expect(popup.locator("#owner-login")).toBeVisible();
  await expect(form(popup)).toBeHidden();
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

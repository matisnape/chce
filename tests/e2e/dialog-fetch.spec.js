// Issue #24: the item dialog ("+ Dodaj") fills itself from a pasted shop link, as the add popup does.
// The Worker is stubbed with page.route, as in fetch.spec.js; CI never calls the live one.
import { test, expect } from "@playwright/test";
import { reset, seedList, listIds, OWNER } from "./emulator.js";

const WORKER = "https://chce.anks14.workers.dev/extract";
const LINK = "https://shop.example/lamp";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" };
const FOUND = { url: LINK, title: "Lamp Aurora", price: "249.9", currency: "EUR", images: ["https://shop.example/a.jpg", "https://shop.example/b.jpg"] };

test.beforeEach(async ({ page }) => {
  await reset();
  await seedList();
  await page.goto("/index.html?emulator");
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#add-item")).toBeVisible();
});

async function stub(page, reply) {
  await page.route(WORKER, (route, request) =>
    request.method() === "OPTIONS" ? route.fulfill({ status: 204, headers: CORS }) : reply(route, request));
}
const fulfill = (route, status, body) =>
  route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});

const fetchBtn = (page) => page.locator("#item-fetch");
const status = (page) => page.locator("#item-fetch-status");
const field = (page, name) => page.locator(`#item-form [name="${name}"]`);

async function openAndPaste(page) {
  await page.click("#add-item");
  await field(page, "url").fill(LINK);
}

test("success: title, price, currency fill, images are offered, and save stores the chosen image", async ({ page }) => {
  await stub(page, (route) => fulfill(route, 200, FOUND));
  await openAndPaste(page);
  await fetchBtn(page).click();
  await expect(field(page, "title")).toHaveValue("Lamp Aurora");
  await expect(field(page, "price")).toHaveValue("249.9");
  await expect(field(page, "currency")).toHaveValue("EUR");
  await expect(page.locator('#item-images input[name="image"]')).toHaveCount(3); // 2 pictures + "bez zdjęcia"
  await expect(field(page, "imageUrl")).toHaveValue("https://shop.example/a.jpg");
  await page.locator('#item-images input[name="image"]').nth(1).check({ force: true });
  await expect(field(page, "imageUrl")).toHaveValue("https://shop.example/b.jpg");
  await expect(status(page)).toContainText("Dane pobrane");
  await page.click('#item-form button[type="submit"]');
  await expect(page.locator("#item-dialog")).toBeHidden();
  expect(await listIds("items")).toHaveLength(3);
  await expect(page.locator('.item:has-text("Lamp Aurora") img')).toHaveAttribute("src", "https://shop.example/b.jpg");
});

test("picking 'bez zdjęcia' empties the image link", async ({ page }) => {
  await stub(page, (route) => fulfill(route, 200, FOUND));
  await openAndPaste(page);
  await fetchBtn(page).click();
  await expect(field(page, "imageUrl")).toHaveValue("https://shop.example/a.jpg");
  await page.locator('#item-images input[name="image"]').last().check({ force: true });
  await expect(field(page, "imageUrl")).toHaveValue("");
});

test("a field typed by hand before the fetch keeps its value", async ({ page }) => {
  await stub(page, (route) => fulfill(route, 200, FOUND));
  await page.click("#add-item");
  await field(page, "title").fill("Moja lampa");
  await field(page, "price").fill("100");
  await field(page, "url").fill(LINK);
  await fetchBtn(page).click();
  await expect(status(page)).toContainText("Dane pobrane");
  await expect(field(page, "title")).toHaveValue("Moja lampa");
  await expect(field(page, "price")).toHaveValue("100");
  await expect(field(page, "currency")).toHaveValue("PLN"); // currency follows the price, which was typed
});

test("Worker 502: the add popup's Polish message shows and the dialog still saves by hand", async ({ page }) => {
  await stub(page, (route) => fulfill(route, 502, { error: "x" }));
  await openAndPaste(page);
  await fetchBtn(page).click();
  await expect(status(page)).toContainText("Sklep nie oddał strony");
  await expect(fetchBtn(page)).toBeEnabled();
  await field(page, "title").fill("Ręcznie");
  await page.click('#item-form button[type="submit"]');
  await expect(page.locator("#item-dialog")).toBeHidden();
  expect(await listIds("items")).toHaveLength(3);
});

test("Worker 502 with a refusing shop: the dialog shows the same shop-refused message", async ({ page }) => {
  await stub(page, (route) => fulfill(route, 502, { error: "fetch_failed", status: 421 }));
  await openAndPaste(page);
  await fetchBtn(page).click();
  await expect(status(page)).toContainText("nie wpuszcza serwera chce (kod 421)");
  await expect(status(page)).toContainText("zakładki");
  await expect(fetchBtn(page)).toBeEnabled();
});

test("editing an existing item shows no fetch button", async ({ page }) => {
  await page.locator(".item-edit").first().click();
  await expect(page.locator("#item-dialog")).toBeVisible();
  await expect(fetchBtn(page)).toBeHidden();
  await page.click("#item-dialog [data-cancel]");
  await page.click("#add-item");
  await expect(fetchBtn(page)).toBeVisible();
});

// The Worker answers only when `release()` is called, so a test decides where the late reply lands.
function gatedWorker() {
  let release;
  const gate = new Promise((ok) => { release = ok; });
  return { release: () => release(), reply: async (route) => { await gate; await fulfill(route, 200, FOUND); } };
}

test("a reply that arrives after save does not refill the reopened dialog", async ({ page }) => {
  const w = gatedWorker();
  await stub(page, w.reply);
  await openAndPaste(page);
  await fetchBtn(page).click();
  await field(page, "title").fill("Ręcznie");
  await page.click('#item-form button[type="submit"]');
  await expect(page.locator("#item-dialog")).toBeHidden();
  await page.click("#add-item");
  w.release(); // the late reply lands while the new dialog is open
  await page.waitForTimeout(500);
  await expect(field(page, "title")).toHaveValue("");
  await expect(field(page, "price")).toHaveValue("");
  await expect(status(page)).toBeHidden();
  await expect(page.locator("#item-images")).toBeHidden();
  expect(await listIds("items")).toHaveLength(3);
});

test("a reply that arrives after Anuluj does not refill the reopened dialog", async ({ page }) => {
  const w = gatedWorker();
  await stub(page, w.reply);
  await openAndPaste(page);
  await fetchBtn(page).click();
  await page.click("#item-dialog [data-cancel]");
  await expect(page.locator("#item-dialog")).toBeHidden();
  await page.click("#add-item");
  w.release();
  await page.waitForTimeout(500);
  await expect(field(page, "title")).toHaveValue("");
  await expect(field(page, "price")).toHaveValue("");
  await expect(status(page)).toBeHidden();
  await expect(page.locator("#item-images")).toBeHidden();
});

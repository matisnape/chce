// Issue #2: the owner curates tabs and items; guests see the result.
import { test, expect } from "@playwright/test";
import { reset, seedList, OWNER, GUEST, asUser, signIn } from "./emulator.js";

const APP = "/index.html?emulator";

test.beforeEach(async ({ page }) => {
  await reset();
  await seedList();
  await page.goto(APP);
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#add-item")).toBeVisible();
});

const titles = (page) => page.locator(".item h3");
const menuItem = async (page, name) => {
  await page.getByRole("button", { name: "Opcje zakładek" }).click();
  await page.getByRole("menuitem", { name }).click();
};

test("owner adds a tab and an item with a Polish-formatted price", async ({ page }) => {
  await menuItem(page, "Nowa zakładka");
  await page.fill('#tab-form [name="name"]', "Szafa");
  await page.fill('#tab-form [name="description"]', "Rozmiar M");
  await page.click('#tab-form button[type="submit"]');
  await expect(page.locator('#tabs a[aria-current="page"] .name')).toHaveText("Szafa");
  await expect(page.locator("#tab-description")).toHaveText("Rozmiar M");

  await page.click("#add-item");
  await page.fill('#item-form [name="title"]', "Kurtka");
  await page.fill('#item-form [name="url"]', "https://shop.example/kurtka");
  await page.fill('#item-form [name="price"]', "1 299,99 zł");
  await page.click('#item-form button[type="submit"]');
  await expect(titles(page)).toHaveText(["Kurtka"]);
  await expect(page.locator(".item .price")).toContainText("1299,99");
});

test("drag reorders items and the order survives a reload and shows for guests", async ({ page, browser }) => {
  await expect(titles(page)).toHaveText(["Książka A", "Książka B"]);
  await page.locator(".item", { hasText: "Książka B" })
    .dragTo(page.locator(".item", { hasText: "Książka A" }), { targetPosition: { x: 20, y: 5 } });
  await expect(titles(page)).toHaveText(["Książka B", "Książka A"]);
  await page.reload();
  await expect(titles(page)).toHaveText(["Książka B", "Książka A"]);

  const guestPage = await (await browser.newContext()).newPage();
  await guestPage.goto(APP);
  await guestPage.fill("#password", GUEST.password);
  await guestPage.click('#gate button[type="submit"]');
  await expect(titles(guestPage)).toHaveText(["Książka B", "Książka A"]);
});

test("dropping an item on another tab moves it there", async ({ page }) => {
  await page.click('#tabs a[data-id="books"]');
  await page.locator(".item", { hasText: "Książka A" }).dragTo(page.locator("#tabs a", { hasText: "Już mam" }));
  await expect(titles(page)).toHaveText(["Książka B"]);
  await page.click('#tabs a:has-text("Już mam")');
  await expect(titles(page)).toHaveText(["Książka A"]);
});

test("owner edits and deletes an item; a tab with items cannot be deleted", async ({ page }) => {
  await page.locator(".item", { hasText: "Książka B" }).getByRole("button", { name: "Edytuj pozycję" }).click();
  await page.fill('#item-form [name="title"]', "Książka B2");
  await page.click('#item-form button[type="submit"]');
  await expect(titles(page)).toHaveText(["Książka A", "Książka B2"]);

  page.once("dialog", (d) => d.accept());
  await page.locator(".item", { hasText: "Książka B2" }).getByRole("button", { name: "Edytuj pozycję" }).click();
  await page.click("#item-delete");
  await expect(titles(page)).toHaveText(["Książka A"]);

  page.once("dialog", (d) => d.accept());
  await page.click('#tabs a[data-id="books"]');
  await menuItem(page, /Edytuj zakładkę/);
  await page.click("#tab-delete");
  await expect(page.locator("#tabs a .name")).toHaveText(["Wszystko", "Książki", "Już mam"]);
});

test("rules: the owner can write", async () => {
  const owner = await signIn(OWNER.email, OWNER.password);
  expect(await asUser(owner, "PATCH", "lists/main", { title: "nowa" })).toBe(200);
});

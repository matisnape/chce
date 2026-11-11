// Issue #45: "Już mam" is a virtual view of items flagged `owned: true`; the item keeps its tab.
import { test, expect } from "@playwright/test";
import { reset, seedList, seedDoc, OWNER, GUEST } from "./emulator.js";

const APP = "/index.html?emulator";
const ownBtn = (scope) => scope.getByRole("button", { name: "Już mam" });
const titles = (page) => page.locator(".item h3");
const ownedLink = (page) => page.locator('#tabs a[data-id="owned"]');

test.beforeEach(async () => {
  await reset();
  await seedList();
});

async function asOwner(page) {
  await page.goto(APP);
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#add-item")).toBeVisible();
}

test("owner: the card button moves the item out of its tab and Wszystko into Już mam", async ({ page }) => {
  await asOwner(page);
  await page.click('#tabs a[data-id="books"]');
  await ownBtn(page.locator(".item", { hasText: "Książka A" })).click();
  await expect(titles(page)).toHaveText(["Książka B"]);
  await expect(page.locator("#tabs a").last()).toHaveAttribute("data-id", "owned");
  await expect(ownedLink(page)).not.toHaveAttribute("draggable", "true");
  await expect(page.locator('#tabs a[data-id="all"]')).toContainText("1");

  await page.click('#tabs a[data-id="all"]');
  await expect(titles(page)).toHaveText(["Książka B"]);
  await ownedLink(page).click();
  await expect(titles(page)).toHaveText(["Książka A"]);
  await expect(page.locator("#edit-tab")).toBeHidden();
  await expect(ownBtn(page.locator(".item"))).toHaveCount(0);

  // owned items stay editable, and the tab select never lists the view
  await page.locator(".item .item-edit").click();
  expect(await page.locator('#item-form [name="tabId"] option').evaluateAll((o) => o.map((x) => x.value))).toEqual(["books", "have"]);
  await expect(page.locator('#item-form [name="owned"]')).toBeChecked();
  await page.fill('#item-form [name="title"]', "Książka A2");
  await page.click('#item-form button[type="submit"]');
  await expect(titles(page)).toHaveText(["Książka A2"]);

  // unchecking the box returns it to its tab
  await page.locator(".item .item-edit").click();
  await page.uncheck('#item-form [name="owned"]');
  await page.click('#item-form button[type="submit"]');
  await expect(titles(page)).toHaveCount(0);
  await page.click('#tabs a[data-id="books"]');
  await expect(titles(page)).toHaveText(["Książka A2", "Książka B"]);
});

test("owner: the dialog checkbox saves a new item straight into Już mam", async ({ page }) => {
  await asOwner(page);
  await page.click("#add-item");
  expect(await page.locator('#item-form [name="tabId"] option').evaluateAll((o) => o.map((x) => x.value))).toEqual(["books", "have"]);
  await page.fill('#item-form [name="title"]', "Nowy");
  await page.check('#item-form [name="owned"]');
  await page.click('#item-form button[type="submit"]');
  await expect(titles(page)).toHaveText(["Książka A", "Książka B"]);
  await ownedLink(page).click();
  await expect(titles(page)).toHaveText(["Nowy"]);
});

test("owner: the dialog checkbox flags an existing item", async ({ page }) => {
  await asOwner(page);
  await page.locator(".item", { hasText: "Książka B" }).locator(".item-edit").click();
  await page.check('#item-form [name="owned"]');
  await page.click('#item-form button[type="submit"]');
  await ownedLink(page).click();
  await expect(titles(page)).toHaveText(["Książka B"]);
});

test("guest: sees the Już mam view but no buttons", async ({ page }) => {
  await seedDoc("lists/main/items/z", { tabId: "books", owned: true, title: "Mam to", url: null, imageUrl: null, price: null, currency: "PLN", description: "", order: 3 });
  await page.goto(APP);
  await page.fill("#password", GUEST.password);
  await page.click('#gate button[type="submit"]');
  await expect(ownedLink(page)).toBeVisible();
  await expect(ownBtn(page)).toHaveCount(0);
});

test("Wszystko hides owned items until the filter is checked; owned cards then carry a label", async ({ page }) => {
  await seedDoc("lists/main/items/z", { tabId: "books", owned: true, title: "Mam to", url: null, imageUrl: null, price: null, currency: "PLN", description: "", order: 3 });
  await page.goto(APP);
  await page.fill("#password", GUEST.password);
  await page.click('#gate button[type="submit"]');
  await expect(titles(page)).toHaveText(["Książka A", "Książka B"]);
  await expect(page.locator('#tabs a[data-id="all"]')).toContainText("2");
  await page.check("#show-owned");
  await expect(titles(page)).toHaveText(["Książka A", "Książka B", "Mam to"]);
  await expect(page.locator('#tabs a[data-id="all"]')).toContainText("3");
  await expect(page.locator(".item .owned-label")).toHaveCount(1);
  await expect(page.locator(".item", { hasText: "Mam to" }).locator(".owned-label")).toHaveText("Już mam");
  await page.reload();
  await expect(page.locator("#show-owned")).not.toBeChecked();
});

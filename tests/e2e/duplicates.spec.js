// Issue #23: adding an item that is already on the list warns first and never blocks.
import { test, expect } from "@playwright/test";
import { reset, seedList, seedDoc, listIds, OWNER } from "./emulator.js";

test.beforeEach(async ({ page }) => {
  await reset();
  await seedList();
  await seedDoc("lists/main/items/n1", { tabId: "books", title: "Zeszyt", url: null, imageUrl: null, price: null, currency: "PLN", description: "", order: 3 });
  await page.goto("/index.html?emulator");
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#add-item")).toBeVisible();
});

const DUP_LINK = "https://www.SHOP.example/a/?utm_source=x";
const warning = (page) => page.locator("#dup-warning");

async function fillDialog(page, title, url, tabId = "books") {
  await page.click("#add-item");
  await page.fill('#item-form [name="title"]', title);
  await page.fill('#item-form [name="url"]', url);
  await page.selectOption('#item-form [name="tabId"]', tabId);
  await page.click('#item-form button[type="submit"]');
}

test("dialog: duplicate link warns with the tab name; cancel keeps the form and saves nothing", async ({ page }) => {
  await fillDialog(page, "Kopia", DUP_LINK);
  await expect(warning(page)).toBeVisible();
  await expect(warning(page)).toContainText("Książki");
  await page.click("#dup-cancel");
  await expect(warning(page)).toBeHidden();
  await expect(page.locator("#item-dialog")).toBeVisible();
  await expect(page.locator('#item-form [name="title"]')).toHaveValue("Kopia");
  expect(await listIds("items")).toHaveLength(3);
});

test("dialog: 'Dodaj mimo to' saves the copy", async ({ page }) => {
  await fillDialog(page, "Kopia", DUP_LINK, "have");
  await expect(warning(page)).toContainText("Książki");
  await page.click("#dup-confirm");
  await expect(page.locator("#item-dialog")).toBeHidden();
  expect(await listIds("items")).toHaveLength(4);
  await page.click('#tabs a[data-id="have"]');
  await expect(page.locator(".item h3")).toHaveText(["Kopia"]);
});

test("dialog: no link, same title warns in the same tab only", async ({ page }) => {
  await fillDialog(page, "  zESZYT ", "", "have");
  await expect(page.locator("#item-dialog")).toBeHidden();
  expect(await listIds("items")).toHaveLength(4);

  await fillDialog(page, "zeszyt", "", "books");
  await expect(warning(page)).toBeVisible();
  expect(await listIds("items")).toHaveLength(4);
});

test("dialog: editing an item and saving it unchanged does not warn", async ({ page }) => {
  await page.locator(".item", { hasText: "Książka A" }).getByRole("button", { name: "Edytuj pozycję" }).click();
  await page.click('#item-form button[type="submit"]');
  await expect(page.locator("#item-dialog")).toBeHidden();
  await expect(warning(page)).toBeHidden();
  expect(await listIds("items")).toHaveLength(3);
});

test("add popup: duplicate link shows the same warning and choices", async ({ page }) => {
  const hash = encodeURIComponent(JSON.stringify({ url: DUP_LINK, title: "Kopia" }));
  await page.goto(`/add.html?emulator#${hash}`);
  await expect(page.locator("#add-form")).toBeVisible();
  await page.click('#add-form button[type="submit"]');
  await expect(warning(page)).toContainText("Książki");
  expect(await listIds("items")).toHaveLength(3);
  await page.click("#dup-cancel");
  await expect(page.locator('#add-form [name="title"]')).toHaveValue("Kopia");
  await page.click('#add-form button[type="submit"]');
  await page.click("#dup-confirm");
  await expect(page.locator("#saved")).toBeVisible();
  expect(await listIds("items")).toHaveLength(4);
});

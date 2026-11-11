// A second share into an add.html tab that is already open changes only the hash (same-document
// navigation, no reload). The form must show the new item, not the first one.
import { test, expect } from "@playwright/test";
import { reset, seedList, OWNER } from "./emulator.js";

test.beforeEach(async () => {
  await reset();
  await seedList();
});

const hashOf = (data) => `#${encodeURIComponent(JSON.stringify(data))}`;

test("a new hash in an already-open add tab refills the form", async ({ page }) => {
  await page.goto("/index.html?emulator");
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#add-item")).toBeVisible();
  const a = { title: "Item A", price: "10", currency: "PLN", url: "https://shop.example/a", images: [] };
  const b = { title: "Item B", price: "20", currency: "PLN", url: "https://shop.example/b", images: [] };
  await page.goto(`/add.html?emulator${hashOf(a)}`);
  await expect(page.locator('[name="title"]')).toHaveValue("Item A");
  await page.goto(`/add.html?emulator${hashOf(b)}`);
  await expect(page.locator('[name="title"]')).toHaveValue("Item B");
  await expect(page.locator('[name="url"]')).toHaveValue("https://shop.example/b");
});

// Issue #22: a click outside the item dialog closes it without saving.
import { test, expect } from "@playwright/test";
import { reset, seedList, OWNER } from "./emulator.js";

test.beforeEach(async ({ page }) => {
  await reset();
  await seedList();
  await page.goto("/index.html?emulator");
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await page.click("#add-item");
  await expect(page.locator("#item-dialog")).toBeVisible();
});

const box = (page) => page.locator("#item-dialog").boundingBox();

test("backdrop click closes the dialog and saves nothing", async ({ page }) => {
  const before = await page.locator(".item").count();
  await page.fill('#item-form [name="title"]', "Nie zapisuj");
  await page.mouse.click(2, 2);
  await expect(page.locator("#item-dialog")).not.toBeVisible();
  await page.reload();
  await expect(page.locator(".item")).toHaveCount(before);
});

test("press inside the title field, release outside: dialog stays open", async ({ page }) => {
  const t = await page.locator('#item-form [name="title"]').boundingBox();
  await page.mouse.move(t.x + 10, t.y + 5);
  await page.mouse.down();
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await expect(page.locator("#item-dialog")).toBeVisible();
});

test("padding, a label and an input do not close the dialog", async ({ page }) => {
  const b = await box(page);
  await page.mouse.click(b.x + 2, b.y + 2); // dialog's own padding
  await expect(page.locator("#item-dialog")).toBeVisible();
  await page.locator("#item-form h2").click();
  await page.locator('#item-form label:has([name="title"])').click({ position: { x: 3, y: 3 } });
  await page.locator('#item-form [name="title"]').click();
  await expect(page.locator("#item-dialog")).toBeVisible();
});

test("Escape still closes the dialog", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expect(page.locator("#item-dialog")).not.toBeVisible();
});

test.describe("at 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("a tap on the backdrop closes the dialog", async ({ page }) => {
    const b = await box(page);
    await page.touchscreen.tap(Math.max(1, b.x / 2), 5);
    await expect(page.locator("#item-dialog")).not.toBeVisible();
  });
});

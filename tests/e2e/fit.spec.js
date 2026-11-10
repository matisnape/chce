// Issue #15: price and currency fit inside the item dialog and the add popup, no sideways scroll.
import { test, expect } from "@playwright/test";
import { reset, seedList, OWNER } from "./emulator.js";

test.beforeEach(async ({ page }) => {
  await reset();
  await seedList();
  await page.goto("/index.html?emulator");
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#add-item")).toBeVisible();
});

const noSideScroll = (locator) =>
  locator.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));

for (const width of [1280, 320]) {
  test(`item dialog has no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.click("#add-item");
    const dialog = page.locator("#item-dialog");
    await expect(dialog).toBeVisible();
    const { scroll, client } = await noSideScroll(dialog);
    expect(scroll).toBe(client);
  });

  test(`add popup form has no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/add.html?emulator");
    const form = page.locator("#add-form");
    await expect(form).toBeVisible();
    const { scroll, client } = await noSideScroll(form);
    expect(scroll).toBe(client);
  });
}

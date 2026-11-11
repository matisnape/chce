// Issue #49: add.html can be left without saving, by "Anuluj" or by the "✕" control.
// Without ?popup=1 both go to the list; with it both close the window. Neither writes anything.
import { test, expect } from "@playwright/test";
import { reset, seedList, listIds, OWNER } from "./emulator.js";

test.beforeEach(async () => {
  await reset();
  await seedList();
});

const CONTROLS = [["Anuluj", "#add-cancel"], ["✕", "#add-close"]];

async function openAdd(page, search = "") {
  await page.addInitScript(() => { window.__closes = 0; window.close = () => { window.__closes++; }; });
  await page.goto("/index.html?emulator");
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#add-item")).toBeVisible();
  await page.goto(`/add.html?emulator${search}`);
  await expect(page.locator('[name="title"]')).toBeVisible();
}

for (const [name, sel] of CONTROLS) {
  test(`${name}: without popup it goes to the list and writes nothing`, async ({ page }) => {
    const before = (await listIds("items")).length;
    await openAdd(page);
    await page.fill('[name="title"]', "Typed then dropped");
    await page.click(sel);
    await expect(page).toHaveURL(/\/(index\.html)?\?emulator$/);
    await expect(page.locator("#add-item")).toBeVisible();
    expect(await page.evaluate(() => window.__closes ?? 0)).toBe(0);
    expect((await listIds("items")).length).toBe(before);
  });

  test(`${name}: with popup=1 it closes the window and writes nothing`, async ({ page }) => {
    const before = (await listIds("items")).length;
    await openAdd(page, "&popup=1");
    await page.fill('[name="title"]', "Typed then dropped");
    await page.click(sel);
    await expect.poll(() => page.evaluate(() => window.__closes)).toBe(1);
    expect(page.url()).toContain("/add.html");
    expect((await listIds("items")).length).toBe(before);
  });
}

test("both controls are at least 44px tall and the close does not overlap the heading", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await openAdd(page);
  const box = (sel) => page.locator(sel).boundingBox();
  for (const [, sel] of CONTROLS) {
    const b = await box(sel);
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.width).toBeGreaterThanOrEqual(44);
  }
  const close = await box("#add-close");
  const h1 = await page.locator("#add-form h1").evaluate((el) => {
    const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect();
    return { right: b.right };
  });
  expect(h1.right).toBeLessThanOrEqual(close.x);
});

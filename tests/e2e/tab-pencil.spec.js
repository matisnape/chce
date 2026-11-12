// Issue #51: the owner gets a pencil next to each real tab heading; guests and "Już mam" get none.
import { test, expect } from "@playwright/test";
import { reset, seedList, OWNER, GUEST } from "./emulator.js";

const APP = "/index.html?emulator";
const pencil = (page) => page.getByRole("button", { name: /^Edytuj zakładkę „/ }).and(page.locator(".tab-edit"));

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

async function asGuest(page) {
  await page.goto(APP);
  await page.fill("#password", GUEST.password);
  await page.click('#gate button[type="submit"]');
  await expect(page.locator(".item h3").first()).toBeVisible();
}

test("owner: one pencil per tab in Wszystko, one on a tab view, none on Już mam", async ({ page }) => {
  await asOwner(page);
  await expect(page.locator("#tabs a").filter({ hasNotText: /Wszystko|Już mam/ })).toHaveCount(2);
  await expect(pencil(page)).toHaveCount(2);
  await expect(page.locator(".section-head h2 + .tab-edit")).toHaveCount(2);
  await page.click('#tabs a[data-id="books"]');
  await expect(pencil(page)).toHaveCount(1);
  await page.click('#tabs a[data-id="owned"]');
  await expect(pencil(page)).toHaveCount(0);
});

test("guest: no pencil in Wszystko or on a tab view", async ({ page }) => {
  await asGuest(page);
  await expect(pencil(page)).toHaveCount(0);
  await page.click('#tabs a[data-id="books"]');
  await expect(pencil(page)).toHaveCount(0);
  await expect(page.locator(".tab-edit:visible")).toHaveCount(0);
});

test("owner: the pencil of the second tab opens the dialog with that tab", async ({ page }) => {
  await asOwner(page);
  await page.getByRole("button", { name: "Edytuj zakładkę „Prezenty”" }).click();
  await expect(page.locator("#tab-dialog")).toBeVisible();
  await expect(page.locator('#tab-form [name="name"]')).toHaveValue("Prezenty");
  await expect(page.locator("#tab-delete")).toBeVisible();
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 375, height: 700 } });
  test("the pencil keeps the heading on one line and is at least 40px", async ({ page }) => {
    await asOwner(page);
    await page.click('#tabs a[data-id="books"]');
    await expect(pencil(page)).toHaveCount(1);
    const btn = pencil(page);
    const [b, h] = await Promise.all([btn.boundingBox(), page.locator("#view-title").boundingBox()]);
    expect(b.width).toBeGreaterThanOrEqual(40);
    expect(b.height).toBeGreaterThanOrEqual(40);
    // same row as the title and no extra line: the title keeps its single-line height
    expect(Math.abs(b.y + b.height / 2 - (h.y + h.height / 2))).toBeLessThan(h.height);
    expect(h.height).toBeLessThan(60);
  });
});

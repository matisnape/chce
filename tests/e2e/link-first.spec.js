// Issue #32: on a phone the item dialog starts with the shop link; wider screens keep the title first.
// The order is the DOM order (not CSS `order`), so reading order and Tab order match what is drawn.
import { test, expect } from "@playwright/test";
import { reset, seedList, OWNER } from "./emulator.js";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

test.beforeEach(async ({ page }) => {
  await reset();
  await seedList();
  await page.goto("/index.html?emulator");
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#add-item")).toBeVisible();
});

const focusedName = (page) => page.evaluate(() => document.activeElement.name || document.activeElement.id);
const firstField = (page) => page.evaluate(() => document.querySelector("#item-form input, #item-form textarea, #item-form select").name);
const field = (page, name) => page.locator(`#item-form [name="${name}"]`);

test("phone, new item: link first and focused, Tab reaches the fetch button, then the title", async ({ page, browserName }) => {
  // Safari skips buttons on a plain Tab (macOS setting); Option+Tab visits every control.
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await page.setViewportSize(PHONE);
  await page.click("#add-item");
  expect(await firstField(page)).toBe("url");
  expect(await focusedName(page)).toBe("url");
  await page.keyboard.press(tab);
  expect(await focusedName(page)).toBe("item-fetch");
  await page.keyboard.press(tab);
  expect(await focusedName(page)).toBe("title");
  // The title sits right under the status line; the picker stays directly before "Link do zdjęcia", which it writes to.
  const next = (id) => page.evaluate((i) => document.getElementById(i).nextElementSibling.querySelector("input")?.name, id);
  expect(await next("item-fetch-status")).toBe("title");
  expect(await next("item-images")).toBe("imageUrl");
});

test("phone, edit: link first and focused", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.locator(".item-edit").first().click();
  await expect(page.locator("#item-dialog")).toBeVisible();
  expect(await firstField(page)).toBe("url");
  expect(await focusedName(page)).toBe("url");
});

test("desktop: title first and focused", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.click("#add-item");
  expect(await firstField(page)).toBe("title");
  expect(await focusedName(page)).toBe("title");
});

test("resizing across 800px while the dialog is closed: the next open matches the width", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.click("#add-item");
  await page.keyboard.press("Escape");
  await page.setViewportSize(DESKTOP);
  await page.click("#add-item");
  expect(await focusedName(page)).toBe("title");
  await page.keyboard.press("Escape");
  await page.setViewportSize(PHONE);
  await page.click("#add-item");
  expect(await focusedName(page)).toBe("url");
  await expect(field(page, "title")).toBeVisible();
});

test("the 800px boundary: 799 wide puts the link first, 800 wide keeps the title first", async ({ page }) => {
  for (const [width, first] of [[799, "url"], [800, "title"]]) {
    await page.setViewportSize({ width, height: 844 });
    await page.click("#add-item");
    expect(await focusedName(page)).toBe(first);
    expect(await firstField(page)).toBe(first);
    await page.keyboard.press("Escape");
  }
});

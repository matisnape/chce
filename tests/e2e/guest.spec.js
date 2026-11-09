// Issue #1: guests open the list with the shared password; the rules let nobody else in.
import { test, expect } from "@playwright/test";
import { reset, seedList, GUEST, asUser, signIn, signUpStranger } from "./emulator.js";

const APP = "/index.html?emulator";

test.beforeEach(async () => {
  await reset();
  await seedList();
});

test("fresh browser sees only the password prompt, and the page is noindex", async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator("#gate")).toBeVisible();
  await expect(page.locator("#list")).toBeHidden();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("wrong password shows an error and no list", async ({ page }) => {
  await page.goto(APP);
  await page.fill("#password", "wrong-password");
  await page.click('#gate button[type="submit"]');
  await expect(page.locator("#gate-error")).toHaveText("Złe hasło.");
  await expect(page.locator("#list")).toBeHidden();
});

test("right password shows tabs and items, and a reload skips the prompt", async ({ page }) => {
  await page.goto(APP);
  await page.fill("#password", GUEST.password);
  await page.click('#gate button[type="submit"]');
  await expect(page.locator("#tabs a")).toHaveText(["Książki", "Już mam"]);
  await expect(page.locator("#tab-description")).toHaveText("Do czytania");
  await expect(page.locator(".item h2")).toHaveText(["Książka A", "Książka B"]);
  await expect(page.locator(".item .price").first()).toContainText("49,90");
  await expect(page.locator(".find-in").first()).toContainText("shop.example");
  await expect(page.locator("#add-item")).toBeHidden();
  await expect(page.locator(".item button")).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".item h2").first()).toHaveText("Książka A");
  await expect(page.locator("#gate")).toBeHidden();
});

test("rules: anonymous, stranger and guest writes are refused", async () => {
  expect(await asUser(null, "GET", "lists/main/tabs")).toBe(403);

  // Anyone can create an account with the public apiKey; that account must see nothing.
  const stranger = await signUpStranger();
  expect(await asUser(stranger, "GET", "lists/main/tabs")).toBe(403);
  expect(await asUser(stranger, "PATCH", "lists/main", { title: "x" })).toBe(403);

  const guest = await signIn(GUEST.email, GUEST.password);
  expect(await asUser(guest, "GET", "lists/main/tabs")).toBe(200);
  expect(await asUser(guest, "PATCH", "lists/main", { title: "x" })).toBe(403);
});

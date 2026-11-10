// Issue #26: on a phone, focusing a field must not zoom the page (iOS zooms below 16px).
import { test, expect } from "@playwright/test";
import { reset, seedList, OWNER } from "./emulator.js";

test.use({ viewport: { width: 390, height: 800 } });

// Text-entry controls only: radio/checkbox/file/hidden never take a keyboard.
const smallFields = (page) => page.evaluate(() =>
  [...document.querySelectorAll("input, select, textarea")]
    .filter((el) => !["radio", "checkbox", "file", "hidden", "submit", "button"].includes(el.type))
    .map((el) => ({ field: `${el.tagName.toLowerCase()}[${el.name || el.id}]`, size: parseFloat(getComputedStyle(el).fontSize) }))
    .filter((f) => f.size < 16));

async function signInOwner(page) {
  await page.goto("/index.html?emulator");
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#add-item")).toBeVisible();
}

test.beforeEach(async () => {
  await reset();
  await seedList();
});

for (const path of ["/index.html?emulator", "/add.html?emulator", "/bookmarklet.html?emulator"]) {
  test(`every text field is at least 16px on ${path}`, async ({ page }) => {
    await page.goto(path);
    expect(await smallFields(page)).toEqual([]);
  });
}

test("fields stay at least 16px when signed in as owner", async ({ page }) => {
  await signInOwner(page);
  expect(await smallFields(page)).toEqual([]);
});

test("FAB stays inside the viewport after the item dialog closes", async ({ page }) => {
  await signInOwner(page);
  await page.click("#add-item");
  await page.focus('#item-form [name="title"]');
  await page.keyboard.press("Escape");
  await expect(page.locator("#item-dialog")).not.toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const { box, vw, vh } = await page.evaluate(() => {
    const r = document.querySelector("#add-item").getBoundingClientRect();
    return { box: { l: r.left, t: r.top, r: r.right, b: r.bottom }, vw: innerWidth, vh: innerHeight };
  });
  expect(box.l).toBeGreaterThanOrEqual(0);
  expect(box.t).toBeGreaterThanOrEqual(0);
  expect(box.r).toBeLessThanOrEqual(vw);
  expect(box.b).toBeLessThanOrEqual(vh);
});

for (const page of ["index.html", "add.html"]) {
  test(`${page} viewport meta does not block pinch zoom`, async ({ page: p }) => {
    await p.goto(`/${page}?emulator`);
    const content = await p.locator('meta[name="viewport"]').getAttribute("content");
    expect(content).not.toMatch(/maximum-scale|user-scalable/);
  });
}

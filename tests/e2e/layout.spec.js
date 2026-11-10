// Issue #19: the "C" layout — tab sidebar, All view, floating add button, muted-pink palette.
import { test, expect } from "@playwright/test";
import { reset, seedList, seedDoc, OWNER, GUEST } from "./emulator.js";

const APP = "/index.html?emulator";

test.beforeEach(async () => {
  await reset();
  await seedList();
});

async function asGuest(page, path = APP) {
  await page.goto(path);
  await page.fill("#password", GUEST.password);
  await page.click('#gate button[type="submit"]');
  await expect(page.locator("#list")).toBeVisible();
}

async function asOwner(page, path = APP) {
  await page.goto(path);
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#list")).toBeVisible();
}

const menuButton = (page) => page.getByRole("button", { name: "Opcje zakładek" });
const titles = (page) => page.locator(".item h3");

test("guest with no hash sees the All view: one heading per tab, its items under it", async ({ page }) => {
  await asGuest(page);
  await expect(page.locator("#view-title")).toHaveText("Wszystko");
  await expect(page.locator(".tab-section h2")).toHaveText(["Książki", "Już mam"]);
  await expect(page.locator(".tab-section").first().locator(".item h3")).toHaveText(["Książka A", "Książka B"]);
  await expect(page.locator(".tab-section").nth(1).locator(".item")).toHaveCount(0);
  await expect(page.locator("#view-count")).toHaveText("2 pozycje");
  await expect(page.locator('#tabs a[aria-current="page"]')).toContainText("Wszystko");
});

test("an unknown tab id falls back to the All view", async ({ page }) => {
  await asGuest(page, `${APP}#tab=nope`);
  await expect(page.locator("#view-title")).toHaveText("Wszystko");
});

test("guest clicks a tab: only its items show, the hash is set and a reload keeps it", async ({ page }) => {
  await asGuest(page);
  await page.locator('#tabs a[data-id="books"]').click();
  await expect(page).toHaveURL(/#tab=books$/);
  await expect(page.locator("#view-title")).toHaveText("Książki");
  await expect(page.locator("#tab-description")).toHaveText("Do czytania");
  await expect(page.locator(".tab-section h2")).toHaveCount(0);
  await expect(titles(page)).toHaveText(["Książka A", "Książka B"]);
  await page.reload();
  await expect(page.locator("#view-title")).toHaveText("Książki");
  await expect(titles(page)).toHaveText(["Książka A", "Książka B"]);
});

test("nav shows Wszystko first and an item count on every entry", async ({ page }) => {
  await asGuest(page);
  await expect(page.locator("#tabs a")).toHaveText([/Wszystko\s*2/, /Książki\s*2/, /Już mam\s*0/]);
});

test("guest sees no owner controls", async ({ page }) => {
  await asGuest(page);
  await expect(page.locator("#add-item")).toBeHidden();
  await expect(menuButton(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Edytuj pozycję" })).toHaveCount(0);
  await expect(page.locator("#bookmarklet-link")).toBeHidden();
  await expect(page.locator("#logout")).toBeVisible();
});

test("owner toggles the sidebar at 1280px and aria-expanded follows", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await asOwner(page);
  const toggle = page.locator("#sidebar-toggle");
  await expect(page.locator("#sidebar")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAttribute("aria-controls", "sidebar");
  await toggle.click();
  await expect(page.locator("#sidebar")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.locator("#sidebar")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});

test("owner adds from a tab view: the dialog preselects that tab and the item lands there", async ({ page }) => {
  await asOwner(page, `${APP}#tab=have`);
  await page.click("#add-item");
  await expect(page.locator("#item-dialog")).toBeVisible();
  await expect(page.locator('#item-form [name="tabId"]')).toHaveValue("have");
  await page.fill('#item-form [name="title"]', "Nowa rzecz");
  await page.click('#item-form button[type="submit"]');
  await expect(titles(page)).toHaveText(["Nowa rzecz"]);
  await page.locator('#tabs a[data-id="books"]').click();
  await expect(titles(page)).toHaveText(["Książka A", "Książka B"]);
});

test("the item edit button is an icon button named Edytuj pozycję", async ({ page }) => {
  await asOwner(page);
  await expect(page.getByRole("button", { name: "Edytuj pozycję" })).toHaveCount(2);
  await page.getByRole("button", { name: "Edytuj pozycję" }).first().click();
  await expect(page.locator('#item-form [name="title"]')).toHaveValue("Książka A");
});

test("⋯ menu: Nowa zakładka opens an empty tab dialog, Edytuj zakładkę the current one", async ({ page }) => {
  await asOwner(page);
  await menuButton(page).click();
  await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menuitem", { name: /Edytuj zakładkę/ })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Nowa zakładka" }).click();
  await expect(page.locator("#tab-dialog")).toBeVisible();
  await expect(page.locator('#tab-form [name="name"]')).toHaveValue("");
  await page.click("#tab-dialog [data-cancel]");

  await page.locator('#tabs a[data-id="books"]').click();
  await menuButton(page).click();
  await page.getByRole("menuitem", { name: "Edytuj zakładkę „Książki”" }).click();
  await expect(page.locator("#tab-dialog")).toBeVisible();
  await expect(page.locator('#tab-form [name="name"]')).toHaveValue("Książki");
});

test("⋯ menu closes on Escape", async ({ page }) => {
  await asOwner(page);
  await menuButton(page).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
});

test("phone, 7 tabs: 4 chips and +4 więcej, no sideways scroll, the button reveals all 8", async ({ page }) => {
  for (let i = 3; i <= 7; i++) await seedDoc(`lists/main/tabs/t${i}`, { name: `Zakładka ${i}`, description: "", order: i });
  await page.setViewportSize({ width: 390, height: 844 });
  await asGuest(page);
  const chips = page.locator("#tabs a");
  await expect(chips.filter({ visible: true })).toHaveCount(4);
  const more = page.locator("#tabs-more");
  await expect(more).toHaveText("+4 więcej");
  await expect(page.locator("#sidebar-toggle")).toBeHidden();
  const widths = () => page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  const [scroll, client] = await widths();
  expect(scroll).toBe(client);
  await more.click();
  await expect(chips.filter({ visible: true })).toHaveCount(8);
  await expect(more).toHaveText("Mniej");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const [scroll2, client2] = await widths();
  expect(scroll2).toBe(client2);
  await more.click();
  await expect(chips.filter({ visible: true })).toHaveCount(4);
});

test("owner drag still works: item dropped on a tab in the nav moves there", async ({ page }) => {
  await asOwner(page);
  await page.locator(".item", { hasText: "Książka A" }).dragTo(page.locator('#tabs a[data-id="have"]'));
  await expect(page.locator('#tabs a[data-id="have"]')).toContainText("1");
  await page.locator('#tabs a[data-id="have"]').click();
  await expect(titles(page)).toHaveText(["Książka A"]);
});

// Contrast: computed colours, with the first opaque background found up the tree.
async function ratios(page, selectors) {
  return page.evaluate((sels) => {
    const parse = (c) => c.match(/[\d.]+/g).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (node) => {
      for (; node; node = node.parentElement) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c.length < 4 || c[3] > 0.99) return c;
      }
      return [255, 255, 255];
    };
    return Object.fromEntries(sels.map((s) => {
      const node = document.querySelector(s);
      if (!node) return [s, 0];
      const a = lum(parse(getComputedStyle(node).color)), b = lum(bgOf(node));
      return [s, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)];
    }));
  }, selectors);
}

for (const scheme of ["light", "dark"]) {
  test(`text contrast is at least 4.5:1 in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await asOwner(page);
    const r = await ratios(page, [
      ".item h3 a", ".find-in a", "#view-count", ".tab-section h2", "#add-item",
      '#tabs a[aria-current="page"]', "#tabs a:not([aria-current])", "#logout", "#bookmarklet-link",
    ]);
    for (const [sel, ratio] of Object.entries(r)) expect(ratio, `${scheme} ${sel}`).toBeGreaterThanOrEqual(4.5);
  });
}

// ---- review fixes (PR 21) ----

const DOCS = "http://127.0.0.1:8085/v1/projects/demo-chce/databases/(default)/documents/lists/main";
const num = (f) => f.doubleValue ?? Number(f.integerValue);
async function orderOf(collection) {
  const r = await fetch(`${DOCS}/${collection}?pageSize=100`, { headers: { Authorization: "Bearer owner" } });
  return Object.fromEntries((await r.json()).documents.map((d) => [d.name.split("/").pop(), num(d.fields.order)]));
}
const idsByOrder = (o) => Object.keys(o).sort((a, b) => o[a] - o[b]);

test("tab drag in the desktop sidebar uses the vertical axis", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await asOwner(page);
  const books = page.locator('#tabs a[data-id="books"]');
  const have = page.locator('#tabs a[data-id="have"]');
  const h = (await have.boundingBox()).height;
  // Lower half, left side: books goes after have.
  await books.dragTo(have, { targetPosition: { x: 10, y: h - 4 } });
  await expect.poll(async () => idsByOrder(await orderOf("tabs"))).toEqual(["have", "books"]);
  await expect(page.locator("#tabs a .name")).toHaveText(["Wszystko", "Już mam", "Książki"]);
  // Upper half, right side: books goes back before have.
  const w = (await have.boundingBox()).width;
  await books.dragTo(have, { targetPosition: { x: w - 10, y: 4 } });
  await expect.poll(async () => idsByOrder(await orderOf("tabs"))).toEqual(["books", "have"]);
});

// Playwright's own dragTo stalls on the phone-sized layout, so the drag events are sent directly.
const dropTab = (page, from, to, fx, fy) => page.evaluate(({ from, to, fx, fy }) => {
  const dt = new DataTransfer();
  const src = document.querySelector(`#tabs a[data-id="${from}"]`);
  const dst = document.querySelector(`#tabs a[data-id="${to}"]`);
  const box = dst.getBoundingClientRect();
  const init = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: box.left + box.width * fx, clientY: box.top + box.height * fy };
  src.dispatchEvent(new DragEvent("dragstart", init));
  dst.dispatchEvent(new DragEvent("dragover", init));
  dst.dispatchEvent(new DragEvent("drop", init));
}, { from, to, fx, fy });

test("tab drag among the phone chips uses the horizontal axis", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asOwner(page);
  await dropTab(page, "books", "have", 0.9, 0.1);
  await expect.poll(async () => idsByOrder(await orderOf("tabs"))).toEqual(["have", "books"]);
  await expect(page.locator("#tabs a .name")).toHaveText(["Wszystko", "Już mam", "Książki"]);
  await dropTab(page, "books", "have", 0.1, 0.9);
  await expect.poll(async () => idsByOrder(await orderOf("tabs"))).toEqual(["books", "have"]);
});

test("keyboard: focus stays on the tab link after Enter", async ({ page }) => {
  await asGuest(page);
  await page.locator('#tabs a[data-id="books"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#view-title")).toHaveText("Książki");
  expect(await page.evaluate(() => document.activeElement.dataset.id)).toBe("books");
});

test("keyboard: focus stays on +N więcej and Mniej", async ({ page }) => {
  for (let i = 3; i <= 7; i++) await seedDoc(`lists/main/tabs/t${i}`, { name: `Zakładka ${i}`, description: "", order: i });
  await page.setViewportSize({ width: 390, height: 844 });
  await asGuest(page);
  const more = page.locator("#tabs-more");
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveText("Mniej");
  expect(await page.evaluate(() => document.activeElement.id)).toBe("tabs-more");
  await page.keyboard.press("Enter");
  await expect(more).toHaveText("+4 więcej");
  expect(await page.evaluate(() => document.activeElement.id)).toBe("tabs-more");
});

test("the password gate keeps 16px of room at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(APP);
  await expect(page.locator("#gate")).toBeVisible();
  const { left, right } = await page.locator("#password").evaluate((n) => { const b = n.getBoundingClientRect(); return { left: b.left, right: innerWidth - b.right }; });
  expect(left).toBeGreaterThanOrEqual(16);
  expect(right).toBeGreaterThanOrEqual(16);
});

test("All view: dropping an item on an item of another tab writes nothing", async ({ page }) => {
  await seedDoc("lists/main/items/d", { tabId: "have", title: "Rzecz D", url: null, imageUrl: null, price: null, currency: "PLN", description: "", order: 1 });
  await asOwner(page);
  const before = await orderOf("items");
  await page.locator(".item", { hasText: "Książka A" }).dragTo(page.locator(".item", { hasText: "Rzecz D" }), { targetPosition: { x: 20, y: 5 } });
  await page.waitForTimeout(500);
  expect(await orderOf("items")).toEqual(before);
  await expect(page.locator(".tab-section").first().locator(".item h3")).toHaveText(["Książka A", "Książka B"]);
});

test("All view: the ⋯ menu has exactly one menu item", async ({ page }) => {
  await asOwner(page);
  await menuButton(page).click();
  await expect(page.getByRole("menuitem")).toHaveCount(1);
});

test("phone: an active tab past the 4th chip is visible right away", async ({ page }) => {
  for (let i = 3; i <= 7; i++) await seedDoc(`lists/main/tabs/t${i}`, { name: `Zakładka ${i}`, description: "", order: i });
  await page.setViewportSize({ width: 390, height: 844 });
  await asGuest(page, `${APP}#tab=t6`);
  await expect(page.locator("#view-title")).toHaveText("Zakładka 6");
  await expect(page.locator('#tabs a[aria-current="page"]')).toBeVisible();
  // Mniej still collapses while that tab stays active.
  await page.locator("#tabs-more").click();
  await expect(page.locator("#tabs-more")).toHaveText("+4 więcej");
});

test("phone: Bookmarklet and Wyloguj are 44px tall", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asOwner(page);
  for (const sel of ["#bookmarklet-link", "#logout"]) {
    expect((await page.locator(sel).boundingBox()).height, sel).toBeGreaterThanOrEqual(44);
  }
});

test("desktop: the nav sits close under the Zakładki label", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await asOwner(page);
  const label = await page.locator(".side-label").boundingBox();
  const first = await page.locator("#tabs a").first().boundingBox();
  expect(first.y - (label.y + label.height)).toBeLessThanOrEqual(16);
});

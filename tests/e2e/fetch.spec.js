// Issue #4: the owner pastes a shop link and the Worker fills the add form. The Worker is stubbed
// with page.route; CI never calls the live one.
import { test, expect } from "@playwright/test";
import { reset, seedList, listIds, OWNER } from "./emulator.js";

const WORKER = "https://chce.anks14.workers.dev/extract";
const LINK = "https://shop.example/lamp";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" };
const FOUND = { url: LINK, title: "Lamp Aurora", price: "249.9", currency: "EUR", images: ["https://shop.example/a.jpg", "https://shop.example/b.jpg"] };

test.beforeEach(async () => {
  await reset();
  await seedList();
});

// Stubs the Worker: `reply(route, request)` answers the POST; the CORS preflight is answered here.
async function stub(page, reply) {
  const seen = [];
  await page.route(WORKER, (route, request) => {
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    seen.push(request);
    return reply(route, request);
  });
  return seen;
}
// A route may already be aborted by the page when the reply is due; that is not a test failure.
const fulfill = (route, status, body) =>
  route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
const json = (status, body, delay = 0) => async (route) => {
  if (delay) await new Promise((ok) => setTimeout(ok, delay));
  await fulfill(route, status, body);
};
// Answers with the entry for the requested link.
const byLink = (map) => (route, request) => fulfill(route, 200, map[request.postDataJSON().url]);

async function openAdd(page, query = "", hash = "") {
  await page.goto("/index.html?emulator");
  await page.waitForFunction(() => window.__signInOwner);
  await page.evaluate(({ email, password }) => window.__signInOwner(email, password), OWNER);
  await expect(page.locator("#add-item")).toBeVisible();
  await page.goto(`/add.html?emulator${query}${hash}`);
  await expect(page.locator("#add-form")).toBeVisible();
}
const paste = (page, link = LINK) => page.fill('[name="url"]', link);
const fetchBtn = (page) => page.locator("#fetch-link");
const status = (page) => page.locator("#fetch-status");

test("success: title, price, currency and images fill in, and save writes the item", async ({ page }) => {
  await stub(page, json(200, FOUND));
  await openAdd(page);
  await paste(page);
  await fetchBtn(page).click();
  await expect(page.locator('[name="title"]')).toHaveValue("Lamp Aurora");
  await expect(page.locator('[name="price"]')).toHaveValue("249.9");
  await expect(page.locator('[name="currency"]')).toHaveValue("EUR");
  await expect(page.locator('input[name="image"]')).toHaveCount(3); // 2 pictures + "bez zdjęcia"
  await expect(page.locator('input[name="image"]').first()).toBeChecked();
  await expect(status(page)).toContainText("Dane pobrane");
  await page.click('button[type="submit"]');
  await expect(page.locator("#saved")).toBeVisible();
  expect(await listIds("items")).toHaveLength(3);
});

test("the request is a POST of the link with the owner's Bearer token", async ({ page }) => {
  const seen = await stub(page, json(200, FOUND));
  await openAdd(page);
  await paste(page);
  await fetchBtn(page).click();
  await expect(status(page)).toContainText("Dane pobrane");
  expect(seen).toHaveLength(1);
  expect(seen[0].headers().authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]*$/);
  expect(seen[0].postDataJSON()).toEqual({ url: LINK });
});

for (const [code, text] of [[401, "Sesja wygasła"], [403, "nie może pobierać"], [503, "chwilowo niedostępna"], [502, "blokować boty"], [400, "nie wygląda na stronę sklepu"]]) {
  test(`Worker ${code}: a message shows and the form still saves by hand`, async ({ page }) => {
    await stub(page, json(code, { error: "x" }));
    await openAdd(page);
    await paste(page);
    await fetchBtn(page).click();
    await expect(status(page)).toContainText(text);
    await expect(fetchBtn(page)).toBeEnabled();
    await page.fill('[name="title"]', "Ręcznie");
    await page.click('button[type="submit"]');
    await expect(page.locator("#saved")).toBeVisible();
    expect(await listIds("items")).toHaveLength(3);
  });
}

test("a network failure shows a message and the form still saves by hand", async ({ page }) => {
  await stub(page, (route) => route.abort());
  await openAdd(page);
  await paste(page);
  await fetchBtn(page).click();
  await expect(status(page)).toContainText("Brak połączenia");
  await page.fill('[name="title"]', "Ręcznie");
  await page.click('button[type="submit"]');
  await expect(page.locator("#saved")).toBeVisible();
});

test("a Worker that never answers is cut off at the timeout", async ({ page }) => {
  await stub(page, () => new Promise(() => {}));
  await openAdd(page, "&fetchTimeout=500");
  await paste(page);
  await fetchBtn(page).click();
  await expect(status(page)).toContainText("trwa za długo");
  await expect(fetchBtn(page)).toBeEnabled();
});

test("a double tap sends one request, and the button is disabled meanwhile", async ({ page }) => {
  const seen = await stub(page, json(200, FOUND, 600));
  await openAdd(page);
  await paste(page);
  await fetchBtn(page).dblclick();
  await expect(fetchBtn(page)).toBeDisabled();
  await expect(status(page)).toContainText("Dane pobrane");
  expect(seen).toHaveLength(1);
  await expect(fetchBtn(page)).toBeEnabled();
});

test("typed fields are kept: only empty fields are filled", async ({ page }) => {
  await stub(page, json(200, FOUND));
  await openAdd(page);
  await page.fill('[name="title"]', "Moja lampa");
  await page.fill('[name="price"]', "100");
  await page.fill('[name="currency"]', "USD");
  await paste(page);
  await fetchBtn(page).click();
  await expect(status(page)).toContainText("Dane pobrane");
  await expect(page.locator('[name="title"]')).toHaveValue("Moja lampa");
  await expect(page.locator('[name="price"]')).toHaveValue("100");
  await expect(page.locator('[name="currency"]')).toHaveValue("USD");
  await expect(page.locator('input[name="image"]')).toHaveCount(3); // images were empty, so they come in
});

test("an empty link gives a message and sends nothing", async ({ page }) => {
  const seen = await stub(page, json(200, FOUND));
  await openAdd(page);
  await fetchBtn(page).click();
  await expect(status(page)).toContainText("Wklej poprawny link");
  expect(seen).toHaveLength(0);
});

const LINK_B = "https://shop.example/lamp-2";
const FOUND_B = { url: LINK_B, title: "Lamp Borealis", price: "310", currency: "USD", images: ["https://shop.example/c.jpg"] };
const imageSrcs = (page) => page.locator("#images img").evaluateAll((l) => l.map((i) => i.getAttribute("src")));

test("a reply that arrives after save does not bring the form back or add a second item", async ({ page }) => {
  let release;
  const gate = new Promise((ok) => { release = ok; });
  await stub(page, async (route) => { await gate; await fulfill(route, 200, FOUND); });
  await openAdd(page);
  await paste(page);
  await fetchBtn(page).click();
  await page.fill('[name="title"]', "Ręcznie");
  await page.click('button[type="submit"]');
  await expect(page.locator("#saved")).toBeVisible();
  release();
  await page.waitForTimeout(500);
  await expect(page.locator("#saved")).toBeVisible();
  await expect(page.locator("#add-form")).toBeHidden();
  await expect(status(page)).not.toContainText("Brak połączenia");
  expect(await listIds("items")).toHaveLength(3);
});

test("a double tap on save writes one item", async ({ page }) => {
  await openAdd(page);
  await page.fill('[name="title"]', "Ręcznie");
  await page.locator('button[type="submit"]').dblclick();
  await expect(page.locator("#saved")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await listIds("items")).toHaveLength(3);
});

test("a second fetch for a corrected link replaces what the first one filled", async ({ page }) => {
  await stub(page, byLink({ [LINK]: FOUND, [LINK_B]: FOUND_B }));
  await openAdd(page);
  await paste(page);
  await fetchBtn(page).click();
  await expect(page.locator('[name="title"]')).toHaveValue("Lamp Aurora");
  await paste(page, LINK_B);
  await fetchBtn(page).click();
  await expect(page.locator('[name="title"]')).toHaveValue("Lamp Borealis");
  await expect(page.locator('[name="price"]')).toHaveValue("310");
  await expect(page.locator('[name="currency"]')).toHaveValue("USD");
  expect(await imageSrcs(page)).toEqual(["https://shop.example/c.jpg"]);
});

test("a second fetch keeps a field the owner edited by hand", async ({ page }) => {
  await stub(page, byLink({ [LINK]: FOUND, [LINK_B]: FOUND_B }));
  await openAdd(page);
  await paste(page);
  await fetchBtn(page).click();
  await expect(page.locator('[name="title"]')).toHaveValue("Lamp Aurora");
  await page.fill('[name="title"]', "Moja lampa");
  await paste(page, LINK_B);
  await fetchBtn(page).click();
  await expect(page.locator('[name="price"]')).toHaveValue("310");
  await expect(page.locator('[name="title"]')).toHaveValue("Moja lampa");
});

test("a second fetch says so when nothing could be filled", async ({ page }) => {
  await stub(page, json(200, FOUND));
  await openAdd(page);
  await paste(page);
  await fetchBtn(page).click();
  await expect(status(page)).toContainText("Dane pobrane");
  await page.fill('[name="title"]', "Moja lampa");
  await page.fill('[name="price"]', "1");
  await page.locator('input[name="image"]').last().check(); // "bez zdjęcia" picked by hand
  await fetchBtn(page).click();
  await expect(status(page)).toContainText("nic nie zmieniono");
});

test("a hostile Worker reply is cut down like the hash: long title, bad images, bad currency", async ({ page }) => {
  await stub(page, json(200, {
    url: LINK, title: "x".repeat(500), price: "9", currency: "<s>",
    images: ["javascript:alert(1)", { url: "https://shop.example/o.jpg" }, "https://shop.example/ok.jpg"],
  }));
  await openAdd(page);
  await paste(page);
  await fetchBtn(page).click();
  await expect(status(page)).toContainText("Dane pobrane");
  expect((await page.locator('[name="title"]').inputValue()).length).toBe(200);
  expect(await imageSrcs(page)).toEqual(["https://shop.example/ok.jpg"]);
  await expect(page.locator('[name="currency"]')).toHaveValue("PLN");
});

test("images that came in the popup hash are kept when the fetch brings others", async ({ page }) => {
  await stub(page, json(200, FOUND));
  const hash = `#${encodeURIComponent(JSON.stringify({ url: LINK, title: "Z hasha", images: ["https://shop.example/h.jpg"] }))}`;
  await openAdd(page, "", hash);
  await fetchBtn(page).click();
  await expect(status(page)).toContainText("Dane pobrane");
  await expect(page.locator('[name="price"]')).toHaveValue("249.9");
  expect(await imageSrcs(page)).toEqual(["https://shop.example/h.jpg"]);
  await expect(page.locator('[name="title"]')).toHaveValue("Z hasha");
});

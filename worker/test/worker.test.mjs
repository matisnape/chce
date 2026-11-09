import test from "node:test";
import assert from "node:assert/strict";
import { createHandler, FetchError, extractFromHtml, slimHtml } from "../src/index.js";

const ENV = {
  OWNER_UID: "owner-uid",
  FIREBASE_PROJECT_ID: "proj",
  ALLOWED_ORIGINS: "https://anks.pl,http://localhost:4173",
};
const NOW = 1_800_000_000_000;
const SHOP = "https://shop.example/p/1";

const b64u = (b) => Buffer.from(b).toString("base64url");
const algo = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const pair = await crypto.subtle.generateKey(algo, true, ["sign", "verify"]);
const other = await crypto.subtle.generateKey(algo, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };

async function token({ key = pair.privateKey, header = {}, claims = {} } = {}) {
  const t = Math.floor(NOW / 1000);
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", ...header }));
  const p = b64u(JSON.stringify({
    aud: "proj", iss: "https://securetoken.google.com/proj", sub: "owner-uid", iat: t - 10, exp: t + 3600, ...claims,
  }));
  const sig = header.alg === "none" ? "" : b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, Buffer.from(`${h}.${p}`)));
  return `${h}.${p}.${sig}`;
}

const page = (html, finalUrl = SHOP) => async () => ({ html, finalUrl });
const handler = (fetchPage = page("<title>x</title>"), { fetchKeys = async () => ({ keys: [jwk], maxAge: 3600 }), now = () => NOW } = {}) =>
  createHandler({ fetchKeys, now, fetchPage });
const post = (h, tok, body = { url: SHOP }, headers = {}) =>
  h(new Request("https://w.test/extract", {
    method: "POST",
    headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...headers },
    body: JSON.stringify(body),
  }), ENV);

test("no token gives 401", async () => {
  assert.equal((await post(handler(), null)).status, 401);
});

test("token signed with an unknown key gives 401", async () => {
  assert.equal((await post(handler(), await token({ key: other.privateKey }))).status, 401);
});

test("expired token gives 401", async () => {
  const exp = Math.floor(NOW / 1000) - 1;
  assert.equal((await post(handler(), await token({ claims: { exp } }))).status, 401);
});

test("wrong aud gives 401", async () => {
  assert.equal((await post(handler(), await token({ claims: { aud: "other" } }))).status, 401);
});

test("wrong iss gives 401", async () => {
  assert.equal((await post(handler(), await token({ claims: { iss: "https://evil.example" } }))).status, 401);
});

test("iat in the future gives 401", async () => {
  const iat = Math.floor(NOW / 1000) + 600;
  assert.equal((await post(handler(), await token({ claims: { iat } }))).status, 401);
});

test("alg none gives 401", async () => {
  assert.equal((await post(handler(), await token({ header: { alg: "none" } }))).status, 401);
});

test("another user's valid token gives 403", async () => {
  assert.equal((await post(handler(), await token({ claims: { sub: "someone-else" } }))).status, 403);
});

test("owner and a JSON-LD product page give 200 with the item", async () => {
  const html = `<html><head><title>Fallback</title>
    <meta property="og:image" content="/img/og.jpg"><meta name="twitter:image" content="/img/og.jpg">
    <script type="application/ld+json">{"@type":"Product","name":"Lamp","offers":{"price":"49.90","priceCurrency":"PLN"}}</script>
    </head><body><img src="/img/big.jpg" width="400" height="300"><img src="/tiny.gif" width="10" height="10"></body></html>`;
  const res = await post(handler(page(html, "https://shop.example/final/p")), await token(), { url: SHOP }, { Origin: "https://anks.pl" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://anks.pl");
  const body = await res.json();
  assert.equal(body.title, "Lamp");
  assert.equal(body.price, "49.90");
  assert.equal(body.currency, "PLN");
  assert.equal(body.url, "https://shop.example/final/p");
  assert.deepEqual(body.images, ["https://shop.example/img/og.jpg", "https://shop.example/img/big.jpg"]);
});

test("<base href> resolves relative images", async () => {
  const html = `<head><base href="https://cdn.example/a/"><meta property="og:image" content="x.jpg"><meta name="twitter:image" content="x.jpg"></head>`;
  const body = await (await post(handler(page(html)), await token())).json();
  assert.deepEqual(body.images, ["https://cdn.example/a/x.jpg"]);
});

test("shop answering 403 gives 502", async () => {
  const blocked = async () => { throw new FetchError(403); };
  const res = await post(handler(blocked), await token());
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "fetch_failed", status: 403 });
});

test("localhost, IP literals and non-http targets give 400", async () => {
  const never = async () => assert.fail("must not fetch");
  const tok = await token();
  for (const url of ["http://localhost/x", "http://127.0.0.1/x", "http://[::1]/x", "http://10.0.0.1/x", "ftp://shop.example/x", "nope"]) {
    assert.equal((await post(handler(never), tok, { url })).status, 400, url);
  }
});

test("preflight from an allowed origin is answered, a disallowed one gets no allow header", async () => {
  const pre = (origin) => handler()(new Request("https://w.test/extract", { method: "OPTIONS", headers: { Origin: origin } }), ENV);
  const ok = await pre("https://anks.pl");
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "https://anks.pl");
  const bad = await pre("https://evil.example");
  assert.equal(bad.headers.get("Access-Control-Allow-Origin"), null);
});

test("errors to a disallowed origin carry no allow header", async () => {
  const res = await post(handler(), null, { url: SHOP }, { Origin: "https://evil.example" });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
});

// --- slimming: the Free plan gives 10 ms CPU, so only what extract() reads reaches linkedom ---

const PRODUCT_PAGE = `<html><head><title>Fallback</title><style>body{color:red}</style><script>var big = 1;</script>
  <meta property="og:image" content="/img/og.jpg">
  <script type="application/ld+json">{"@type":"Product","name":"Lamp","offers":{"price":"49.90","priceCurrency":"PLN"}}</script>
  </head><body><img src="/img/big.jpg" width="400" height="300"><img src="/tiny.gif" width="10" height="10"></body></html>`;
const ITEMPROP_PAGE = `<html><head><title>Shoe</title><base href="https://cdn.example/s/"></head><body>
  <span class="p" itemprop="price">19<small>,99</small></span><meta itemprop="priceCurrency" content="EUR">
  <span itemprop="priceValidUntil">2030</span><img src="a.jpg" width="300" height="300"></body></html>`;

test("slimmed and full parse give the same result on the fixtures", () => {
  for (const html of [PRODUCT_PAGE, ITEMPROP_PAGE]) {
    const url = "https://shop.example/final/p";
    assert.deepEqual(extractFromHtml(html, url), extractFromHtml(html, url, { full: true }));
  }
  assert.equal(extractFromHtml(ITEMPROP_PAGE, SHOP).price, "19,99");
  assert.equal(extractFromHtml(ITEMPROP_PAGE, SHOP).currency, "EUR");
});

test("a 1.5 MB page slims under 100 KB and still gives the full-parse result", () => {
  const filler = '<div class="row"><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p><a href="/x">link</a></div>\n'.repeat(16_000);
  const html = PRODUCT_PAGE.replace("<body>", `<body>${filler}`).replace("</body>", `${filler}</body>`);
  assert.ok(html.length > 1_500_000, `fixture is ${html.length} bytes`);
  const slim = slimHtml(html);
  assert.ok(slim.length < 100_000, `slimmed is ${slim.length} bytes`);
  assert.deepEqual(extractFromHtml(html, SHOP), extractFromHtml(html, SHOP, { full: true }));
});

test("slimming keeps at most 60 img tags and drops a cut-off JSON-LD block", () => {
  const imgs = '<img src="/i.jpg" width="200" height="200">'.repeat(100);
  assert.equal(slimHtml(`<head></head><body>${imgs}</body>`).match(/<img/g).length, 60);
  const huge = `<script type="application/ld+json">{"x":"${"a".repeat(70_000)}"}</script>`;
  assert.ok(slimHtml(`<head></head><body>${huge}<img src="/z.jpg"></body>`).length < 1_000);
});

// --- JWK cache: refetch on an unknown kid at most once a minute, and when max-age runs out ---

test("an unknown kid refetches the keys at most once per 60 s", async () => {
  let calls = 0, clock = NOW;
  const fetchKeys = async () => { calls++; return { keys: [jwk], maxAge: 3600 }; };
  const h = handler(undefined, { fetchKeys, now: () => clock });
  const bad = await token({ header: { kid: "nope" } });
  assert.equal((await post(h, bad)).status, 401);
  assert.equal((await post(h, bad)).status, 401);
  assert.equal(calls, 1);
  clock += 61_000;
  assert.equal((await post(h, bad)).status, 401);
  assert.equal(calls, 2);
});

test("keys are refetched once max-age has passed, not before", async () => {
  let calls = 0, clock = NOW;
  const fetchKeys = async () => { calls++; return { keys: [jwk], maxAge: 100 }; };
  const h = handler(undefined, { fetchKeys, now: () => clock });
  const tok = await token();
  assert.equal((await post(h, tok)).status, 200);
  clock += 99_000;
  assert.equal((await post(h, tok)).status, 200);
  assert.equal(calls, 1);
  clock += 2_000;
  assert.equal((await post(h, tok)).status, 200);
  assert.equal(calls, 2);
});

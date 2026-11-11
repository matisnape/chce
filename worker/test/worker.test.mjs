import test, { after } from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import { createHandler, createFetchPage, BadTarget, FetchError, extractFromHtml, slimHtml } from "../src/index.js";

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
  // Always a valid RS256 signature, so a wrong `alg` header is rejected by the alg check and by nothing else.
  const sig = b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, Buffer.from(`${h}.${p}`)));
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

test("a header alg other than RS256 gives 401 even with a valid signature", async () => {
  for (const alg of ["none", "HS256"]) {
    assert.equal((await post(handler(), await token({ header: { alg } }))).status, 401, alg);
  }
});

test("a token without a sub gives 401, not 403", async () => {
  assert.equal((await post(handler(), await token({ claims: { sub: "" } }))).status, 401);
  assert.equal((await post(handler(), await token({ claims: { sub: undefined } }))).status, 401);
});

test("another user's valid token gives 403", async () => {
  assert.equal((await post(handler(), await token({ claims: { sub: "someone-else" } }))).status, 403);
});

test("owner and a JSON-LD product page give 200 with the item", async () => {
  const html = `<html><head><title>Fallback</title>
    <meta property="og:image" content="/img/og.jpg">
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
  const html = `<head><base href="https://cdn.example/a/"><meta property="og:image" content="x.jpg"></head>`;
  const body = await (await post(handler(page(html)), await token())).json();
  assert.deepEqual(body.images, ["https://cdn.example/a/x.jpg"]);
});

test("shop answering 403 gives 502", async () => {
  const blocked = async () => { throw new FetchError(403); };
  const res = await post(handler(blocked), await token());
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "fetch_failed", status: 403 });
});

test("shop answering 421 gives 502 with that status", async () => {
  const refusedHere = async () => { throw new FetchError(421); };
  const res = await post(handler(refusedHere), await token());
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "fetch_failed", status: 421 });
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

// Nested same-name tags, followed by JSON-LD that a wrong close would pull into the price.
const NESTED_PAGE = `<html><head><title>Boot</title></head><body>
  <span itemprop="price"><span>49</span><span>,90</span></span><meta itemprop="priceCurrency" content="PLN">
  <script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script></body></html>`;

test("slimmed and full parse give the same result on the fixtures", () => {
  for (const html of [PRODUCT_PAGE, ITEMPROP_PAGE, NESTED_PAGE]) {
    const url = "https://shop.example/final/p";
    assert.deepEqual(extractFromHtml(html, url), extractFromHtml(html, url, { full: true }));
  }
  assert.equal(extractFromHtml(ITEMPROP_PAGE, SHOP).price, "19,99");
  assert.equal(extractFromHtml(ITEMPROP_PAGE, SHOP).currency, "EUR");
  assert.equal(extractFromHtml(NESTED_PAGE, SHOP).price, "49,90");
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

test("ports other than 80 and 443 give 400", async () => {
  const never = async () => assert.fail("must not fetch");
  const tok = await token();
  for (const url of ["http://shop.example:22/x", "https://shop.example:8443/x", "http://shop.example:6379/"]) {
    assert.equal((await post(handler(never), tok, { url })).status, 400, url);
  }
  for (const url of ["http://shop.example:80/x", "https://shop.example:443/x", "https://shop.example/x"]) {
    assert.equal((await post(handler(page("<title>x</title>")), tok, { url })).status, 200, url);
  }
});

// --- createFetchPage against a local server; the fetch stand-in maps http(s)://shop.test onto it ---

const PAGE_CAP = 2 * 1024 * 1024;
const server = http.createServer((req, res) => {
  const send = (status, headers, body = "") => { res.writeHead(status, headers); res.end(body); };
  const html = { "Content-Type": "text/html; charset=utf-8" };
  switch (req.url) {
    case "/html": return send(200, html, "<title>ok</title>");
    case "/json": return send(200, { "Content-Type": "application/json" }, "{}");
    case "/big": return send(200, html, `<title>start</title>${"a".repeat(3 * 1024 * 1024)}`);
    case "/pl": return send(200, { "Content-Type": "text/html; charset=windows-1250" }, Buffer.concat([Buffer.from("<title>z"), Buffer.from([0xb3]), Buffer.from("ota</title>")]));
    case "/badcharset": return send(200, { "Content-Type": "text/html; charset=nope-9" }, "<title>ok</title>");
    case "/rel": return send(302, { Location: "/html" });
    case "/chain": return send(302, { Location: "/rel" });
    case "/to-ip": return send(302, { Location: "http://127.0.0.1/" });
    case "/to-self": return send(302, { Location: `http://127.0.0.1:${server.address().port}/html` });
    case "/to-port": return send(302, { Location: "http://shop.test:22/x" });
    case "/to-file": return send(302, { Location: "file:///etc/passwd" });
    case "/loop": return send(302, { Location: "/loop" });
    case "/hang": return; // never answers
    default: return send(404, html, "nope");
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
after(() => { server.closeAllConnections?.(); server.close(); });
const toLocal = (u, init) => {
  const x = new URL(u);
  assert.equal(x.hostname, "shop.test", `fetched ${u}`); // anything else would be a request the Worker should have refused
  x.protocol = "http:"; x.host = `127.0.0.1:${server.address().port}`;
  return fetch(x, init);
};
const fetchPage = createFetchPage(toLocal);
const refused = (status) => (e) => e instanceof FetchError && e.status === status;

test("fetchPage returns html and the final url", async () => {
  assert.deepEqual(await fetchPage("http://shop.test/html"), { html: "<title>ok</title>", finalUrl: "http://shop.test/html" });
});

test("fetchPage rejects a non-HTML content type", async () => {
  await assert.rejects(fetchPage("http://shop.test/json"), refused(200));
});

test("fetchPage rejects an HTTP error status", async () => {
  await assert.rejects(fetchPage("http://shop.test/missing"), refused(404));
});

test("fetchPage truncates a body over the cap", async () => {
  const { html } = await fetchPage("http://shop.test/big");
  assert.equal(html.length, PAGE_CAP);
  assert.ok(html.startsWith("<title>start</title>"));
});

test("fetchPage decodes the charset from Content-Type, and falls back to utf-8 for an unknown one", async () => {
  assert.equal((await fetchPage("http://shop.test/pl")).html, "<title>złota</title>");
  assert.equal((await fetchPage("http://shop.test/badcharset")).html, "<title>ok</title>");
});

test("fetchPage follows relative redirects and reports the final url", async () => {
  assert.deepEqual(await fetchPage("http://shop.test/chain"), { html: "<title>ok</title>", finalUrl: "http://shop.test/html" });
});

test("fetchPage refuses a redirect to an IP literal, a bad port or a non-http scheme", async () => {
  for (const path of ["/to-ip", "/to-self", "/to-port", "/to-file"]) {
    await assert.rejects(fetchPage(`http://shop.test${path}`), BadTarget, path);
  }
});

test("a redirect to 127.0.0.1 gives 400 through the handler", async () => {
  const res = await post(handler(fetchPage), await token(), { url: "http://shop.test/to-ip" });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "bad_url" });
});

test("fetchPage gives up after 5 redirects: the first fetch plus 5 hops", async () => {
  let fetches = 0;
  const counting = createFetchPage((u, init) => { fetches++; return toLocal(u, init); });
  await assert.rejects(counting("http://shop.test/loop"), refused(0));
  assert.equal(fetches, 6);
});

test("fetchPage aborts a shop that never answers at the timeout", { timeout: 5_000 }, async () => {
  const slow = createFetchPage(toLocal, { timeoutMs: 300 });
  const t0 = Date.now();
  await assert.rejects(slow("http://shop.test/hang"), refused(0));
  const took = Date.now() - t0;
  assert.ok(took >= 250 && took < 2_000, `aborted after ${took} ms`);
});

test("an oversized head is cut at a tag boundary, never inside a script or a tag", () => {
  const ld = (n) => `<script type="application/ld+json">{"@type":"Product","name":"${"n".repeat(n)}"}</script>`;
  // ~130 KB: the 100 KB cut lands inside the second JSON-LD block
  const head = `<title>t</title>${ld(30_000)}${'<meta name="k" content="v">'.repeat(1_500)}${ld(60_000)}`;
  const slim = slimHtml(`<html><head>${head}</head><body></body></html>`);
  assert.ok(slim.length < 100_000, `slimmed is ${slim.length} bytes`);
  assert.equal(slim.match(/<script/g).length, slim.match(/<\/script>/g).length, "every <script> is closed");
  assert.ok(slim.split("<body>")[0].endsWith(">"), "the head ends at a tag");
  assert.ok(slim.includes("<title>t</title>"));
});

test("a long meta tag across the head cap is dropped whole, not cut in half", () => {
  // The 100 KB cut lands inside the long meta tag; the head must end at the tag before it.
  const head = `${'<meta name="k" content="v">'.repeat(3_700)}<meta name="long" content="${"x".repeat(500)}">`;
  const slim = slimHtml(`<html><head>${head}</head><body></body></html>`);
  assert.ok(slim.length < 100_000, `slimmed is ${slim.length} bytes`);
  assert.ok(!slim.includes('name="long"'), "the straddling tag is gone");
  assert.equal(slim.split("<body>")[0].replace(/<[^<>]*>/g, "").includes("<"), false, "no half-open tag is left");
});

// --- key fetch: one shared fetch, 503 on outage, retry after a failure ---

test("concurrent requests on a fresh handler share one key fetch and both succeed", async () => {
  let calls = 0;
  const fetchKeys = async () => { calls++; await new Promise((ok) => setTimeout(ok, 30)); return { keys: [jwk], maxAge: 3600 }; };
  const h = handler(undefined, { fetchKeys });
  const tok = await token();
  const statuses = (await Promise.all([post(h, tok), post(h, tok)])).map((r) => r.status);
  assert.deepEqual(statuses, [200, 200]);
  assert.equal(calls, 1);
});

test("a key refetch that fails after max-age still verifies a token with a cached kid", async () => {
  let calls = 0, clock = NOW;
  const fetchKeys = async () => { if (++calls > 1) throw new Error("jwk down"); return { keys: [jwk], maxAge: 100 }; };
  const h = handler(undefined, { fetchKeys, now: () => clock });
  const tok = await token();
  assert.equal((await post(h, tok)).status, 200);
  clock += 101_000;
  assert.equal((await post(h, tok)).status, 200);
  assert.equal(calls, 2, "the refetch was tried and failed");
});

test("a failing key fetch gives 503, and the next request retries at once", async () => {
  let calls = 0;
  const fetchKeys = async () => { if (++calls === 1) throw new Error("jwk down"); return { keys: [jwk], maxAge: 3600 }; };
  const h = handler(undefined, { fetchKeys });
  const tok = await token();
  const first = await post(h, tok);
  assert.equal(first.status, 503);
  assert.deepEqual(await first.json(), { error: "keys_unavailable" });
  assert.equal((await post(h, tok)).status, 200);
  assert.equal(calls, 2);
});

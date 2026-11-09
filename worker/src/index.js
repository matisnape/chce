// Fetches a shop page for the owner and returns what js/extract.js reads from it.
import { parseHTML } from "linkedom";
import { extract } from "../../js/extract.js";

const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const SKEW = 60;
const REFETCH_MS = 60_000; // at most one JWK refetch per minute per isolate
const MAX_HOPS = 5;
const TIMEOUT_MS = 6_000;
const MAX_BYTES = 2 * 1024 * 1024;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const json = (s) => JSON.parse(new TextDecoder().decode(b64(s)));

async function defaultFetchKeys() {
  const r = await fetch(JWK_URL);
  if (!r.ok) throw new Error("jwk fetch failed");
  const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get("cache-control") ?? "")?.[1] ?? 300);
  return { keys: (await r.json()).keys, maxAge };
}

// The key set could not be loaded and no cached key matches: the owner should retry, not re-login.
export class KeysUnavailable extends Error {}

// Cached key for `kid`; refetches when the kid is unknown or max-age ran out, but not within REFETCH_MS of the
// last successful fetch. Concurrent callers share one in-flight fetch; a failed fetch starts no throttle window.
async function findKey(kid, { fetchKeys, now, cache }) {
  const t = now();
  let jwk = cache.keys?.find((k) => k.kid === kid);
  if ((!jwk || t >= cache.expires) && (cache.inflight || t - cache.fetchedAt >= REFETCH_MS)) {
    cache.inflight ??= fetchKeys().then(({ keys, maxAge }) => {
      cache.keys = keys; cache.expires = t + maxAge * 1000; cache.fetchedAt = t;
    }).finally(() => { cache.inflight = null; });
    try { await cache.inflight; } catch { if (!jwk) throw new KeysUnavailable(); } // a stale cached key still beats an outage
    jwk = cache.keys?.find((k) => k.kid === kid);
  }
  return jwk;
}

// Shortens `s` to at most `max` chars without cutting inside a tag or an open <script>.
function cutAtBoundary(s, max) {
  if (s.length <= max) return s;
  let cut = s.slice(0, max);
  const open = cut.lastIndexOf("<script");
  if (open > cut.lastIndexOf("</script>")) cut = cut.slice(0, open);
  return cut.slice(0, cut.lastIndexOf(">") + 1);
}

// Returns the verified claims, or throws.
async function verifyToken(token, env, { fetchKeys, now, cache }) {
  const [h, p, s, extra] = token.split(".");
  if (!s || extra !== undefined) throw new Error("malformed");
  const header = json(h);
  if (header.alg !== "RS256" || !header.kid) throw new Error("alg");
  const jwk = await findKey(header.kid, { fetchKeys, now, cache });
  if (!jwk) throw new Error("unknown kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("signature");
  const c = json(p);
  const t = Math.floor(now() / 1000);
  if (c.aud !== env.FIREBASE_PROJECT_ID) throw new Error("aud");
  if (c.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`) throw new Error("iss");
  if (!(c.exp > t)) throw new Error("exp");
  if (!(c.iat <= t + SKEW)) throw new Error("iat");
  if (typeof c.sub !== "string" || !c.sub) throw new Error("sub");
  return c;
}

export class FetchError extends Error {
  constructor(status) { super(`fetch failed: ${status}`); this.status = status; }
}
// A redirect led somewhere checkTarget refuses.
export class BadTarget extends Error {}

function checkTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  if (u.port !== "" && u.port !== "80" && u.port !== "443") return null; // URL drops a default port
  // IPv6 literals keep their brackets in hostname; IPv4 literals are digits and dots.
  if (host === "localhost" || host.endsWith(".localhost") || host.startsWith("[") || /^[\d.]+$/.test(host)) return null;
  return u;
}

// Reads at most MAX_BYTES of the body; the rest is dropped.
async function readCapped(res) {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks = []; let n = 0;
  while (n < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.length;
  }
  reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(n, MAX_BYTES));
  let o = 0;
  for (const c of chunks) { const part = c.subarray(0, all.length - o); all.set(part, o); o += part.length; }
  return all;
}

// Decodes with the charset the Content-Type names; unknown labels fall back to utf-8.
function decode(bytes, contentType) {
  const label = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try { return new TextDecoder(label).decode(bytes); }
  catch (e) { if (!(e instanceof RangeError)) throw e; return new TextDecoder().decode(bytes); }
}

// Returns a fetchPage: { html, finalUrl }. Throws FetchError(status) when the shop does not hand over HTML,
// BadTarget when a redirect leads somewhere checkTarget refuses. Redirects are followed by hand so every hop is checked.
export function createFetchPage(fetchImpl = fetch) {
  return async (startUrl) => {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let url = startUrl;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      let res;
      try {
        res = await fetchImpl(url, {
          redirect: "manual", signal,
          headers: { "User-Agent": UA, "Accept-Language": "pl,en", Accept: "text/html,application/xhtml+xml" },
        });
      } catch { throw new FetchError(0); }
      const loc = [301, 302, 303, 307, 308].includes(res.status) ? res.headers.get("Location") : null;
      if (loc) {
        res.body?.cancel().catch(() => {});
        let next = null;
        try { next = checkTarget(new URL(loc, url).href); } catch { /* unparsable Location */ }
        if (!next) throw new BadTarget(loc);
        url = next.href;
        continue;
      }
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !/html/i.test(type)) throw new FetchError(res.status);
      return { html: decode(await readCapped(res), type), finalUrl: url };
    }
    throw new FetchError(0); // more than MAX_HOPS redirects
  };
}
const defaultFetchPage = createFetchPage();

const VOID = /^(meta|link|input|base|img|br|hr|source)$/i;

// Cheap string work that keeps only what js/extract.js reads, so linkedom parses a few KB instead of the page.
// Free-plan CPU is 10 ms per request; a full linkedom parse costs 15-270 ms.
// ponytail: regex scan, not a parser; odd markup (a ">" inside an attribute) may lose an element.
export function slimHtml(html) {
  const hm = /<head[\s>][\s\S]*?<\/head>/i.exec(html);
  let head, rest;
  if (hm) { head = hm[0]; rest = html.slice(0, hm.index) + html.slice(hm.index + head.length); }
  else {
    const b = html.search(/<body[\s>]/i);
    head = `<head>${html.slice(0, b < 0 ? 100_000 : Math.min(b, 100_000))}</head>`; rest = html;
  }
  // Inline CSS/JS in the head is bulk; only JSON-LD scripts and metadata matter.
  head = cutAtBoundary(head.replace(/<style[\s\S]*?<\/style>|<!--[\s\S]*?-->|<script\b(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, ""), 100_000);
  if (!/<base\b/i.test(head)) head = head.replace(/<head(?:\s[^>]*)?>/i, (h) => h + (/<base\b[^>]*>/i.exec(rest)?.[0] ?? ""));

  const take = (re, n, each) => { const out = []; for (let m; out.length < n && (m = re.exec(rest)); ) each(m, out); return out; };
  const ld = take(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi, 20,
    (m, out) => { if (m[0].length <= 65_536) out.push(m[0]); }); // over 64 KB is skipped whole, to save CPU: JSON.parse of a huge block costs more than the page is worth
  const props = take(/<([a-z][a-z0-9]*)\b[^>]*\bitemprop\s*=\s*["']?(?:price|priceCurrency)(?=["'\s>])[^>]*>/gi, 40, (m, out) => {
    let s = m[0];
    if (!VOID.test(m[1])) {
      const tail = rest.slice(m.index + s.length, m.index + s.length + 500);
      // The matching close: a same-name tag inside opens a nested level (<span itemprop="price"><span>49</span>...).
      const tags = new RegExp(`<(/?)${m[1]}\\b[^>]*>`, "gi");
      let depth = 1, end = -1;
      for (let t; (t = tags.exec(tail)); ) {
        depth += t[1] ? -1 : 1;
        if (depth === 0) { end = t.index; break; }
      }
      s += (end < 0 ? "" : tail.slice(0, end)) + `</${m[1]}>`;
    }
    out.push(s);
  });
  const imgs = take(/<img\b[^>]*>/gi, 60, (m, out) => out.push(m[0]));
  return `<!doctype html><html>${head}<body>${props.join("")}${ld.join("")}${imgs.join("")}</body></html>`;
}

// Gives extract() the few browser fields it reads, on top of the linkedom document.
// `full: true` parses the whole page (tests compare it with the slimmed path).
export function extractFromHtml(html, finalUrl, { full = false } = {}) {
  const { document } = parseHTML(full ? html : slimHtml(html));
  const baseHref = document.querySelector("base[href]")?.getAttribute("href");
  let base = finalUrl;
  try { if (baseHref) base = new URL(baseHref, finalUrl).href; } catch { /* keep the final url */ }
  const dim = (img, k) => Number.parseInt(img.getAttribute(k), 10) || 0;
  const images = [...document.querySelectorAll("img")].map((img) => ({
    currentSrc: "",
    src: img.getAttribute("src") ?? "",
    naturalWidth: 0, naturalHeight: 0, // no layout on the server: declared size only
    width: dim(img, "width"), height: dim(img, "height"),
  }));
  const over = { location: { href: finalUrl }, baseURI: base, images, title: document.title };
  const doc = new Proxy(document, {
    get: (t, k) => (k in over ? over[k] : typeof t[k] === "function" ? t[k].bind(t) : t[k]),
  });
  return extract(doc);
}

export function createHandler({ fetchKeys, now, fetchPage }) {
  const cache = { keys: null, expires: 0, fetchedAt: -Infinity, inflight: null }; // per isolate
  return async (req, env) => {
    const origin = req.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim());
    const cors = origin && allowed.includes(origin)
      ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
    const reply = (status, body, extra = {}) =>
      new Response(body === null ? null : JSON.stringify(body), {
        status, headers: { ...cors, ...(body === null ? {} : { "Content-Type": "application/json" }), ...extra },
      });

    if (new URL(req.url).pathname !== "/extract") return reply(404, { error: "not_found" });
    if (req.method === "OPTIONS") {
      return cors["Access-Control-Allow-Origin"]
        ? reply(204, null, { "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600" })
        : reply(403, null);
    }
    if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

    const m = /^Bearer (.+)$/.exec(req.headers.get("Authorization") ?? "");
    let claims;
    try {
      if (!m) throw new Error("no token");
      claims = await verifyToken(m[1], env, { fetchKeys, now, cache });
    } catch (e) {
      return e instanceof KeysUnavailable ? reply(503, { error: "keys_unavailable" }) : reply(401, { error: "unauthorized" });
    }
    if (claims.sub !== env.OWNER_UID) return reply(403, { error: "forbidden" });

    let target;
    try { target = checkTarget((await req.json()).url); } catch { target = null; }
    if (!target) return reply(400, { error: "bad_url" });

    try {
      const { html, finalUrl } = await fetchPage(target.href);
      return reply(200, extractFromHtml(html, finalUrl ?? target.href));
    } catch (e) {
      if (e instanceof BadTarget) return reply(400, { error: "bad_url" });
      return reply(502, { error: "fetch_failed", status: e instanceof FetchError ? e.status : 0 });
    }
  };
}

const handler = createHandler({ fetchKeys: defaultFetchKeys, now: Date.now, fetchPage: defaultFetchPage });
export default { fetch: handler };

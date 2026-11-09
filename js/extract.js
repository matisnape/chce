// Reads what the list needs from a shop page. It runs INSIDE the shop page (the bookmarklet inlines
// it with Function.prototype.toString), so it must stay self-contained: no imports, no outer names.
export function extract(doc) {
  const MAX_IMAGES = 8;
  const MIN_SIDE = 100;
  const meta = (...keys) => {
    for (const k of keys) {
      const m = doc.querySelector(`meta[property="${k}"], meta[name="${k}"], meta[itemprop="${k}"]`);
      const v = m?.getAttribute("content")?.trim();
      if (v) return v;
    }
    return null;
  };
  const text = (v) => (typeof v === "string" ? v.trim() : ""); // JSON-LD names may be objects
  const abs = (u) => { try { const x = new URL(u, doc.baseURI); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };

  // JSON-LD: walk every object (arrays, @graph) and collect offers and images.
  const nodes = [];
  // Everything under these keys describes other products, not the page's own.
  const RELATED = ["itemListElement", "isRelatedTo", "isSimilarTo", "isAccessoryOrSparePartFor", "isConsumableFor"];
  const related = new Set();
  const walk = (v, rel = false) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, rel));
    else if (v && typeof v === "object") {
      nodes.push(v);
      if (rel) related.add(v);
      for (const [k, c] of Object.entries(v)) walk(c, rel || RELATED.includes(k));
    }
  };
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try { walk(JSON.parse(s.textContent)); } catch { /* broken JSON-LD is common; skip it */ }
  }
  const hasPrice = (n) => n && typeof n === "object" && (n.price != null || n.lowPrice != null);
  const isProduct = (n) => n && typeof n === "object" && [].concat(n["@type"]).includes("Product");
  // A Product listed under itemListElement or isRelatedTo is a demoted fallback.
  const pick = (list) => list.find((p) => p.offers) ?? list[0];
  const products = nodes.filter(isProduct);
  const product = pick(products.filter((p) => !related.has(p))) ?? pick(products);
  // The product's own offer first (object, array, AggregateOffer); the global search is a fallback
  // that skips everything under a related-products key, which prices other products.
  const offer = [].concat(product?.offers ?? []).find(hasPrice) ?? nodes.find((n) => hasPrice(n) && !related.has(n));
  const offerPrice = offer ? offer.price ?? offer.lowPrice : null;

  const price = meta("product:price:amount", "og:price:amount", "price")
    ?? (offerPrice != null ? String(offerPrice) : null)
    ?? doc.querySelector('[itemprop="price"]')?.textContent?.trim() ?? null;
  const currency = meta("product:price:currency", "og:price:currency", "priceCurrency") ?? offer?.priceCurrency ?? null;

  // Images: what the shop declares first, then the page's largest pictures.
  const declared = [meta("og:image:secure_url", "og:image"), meta("twitter:image")]
    .concat([].concat(product?.image ?? []).map((i) => (typeof i === "string" ? i : i?.url)));
  // Lazy images have no natural size until loaded: fall back to layout size, and to data-src
  // when src is empty or a data: placeholder. Images of unknown size go after the sized ones.
  const onPage = [...doc.images].map((img) => {
    const r = img.getBoundingClientRect();
    const own = img.currentSrc || img.src;
    const lazySrc = !own || own.startsWith("data:") ? img.getAttribute("data-src") : null;
    // a placeholder's own natural size (often 1x1) says nothing about the real picture
    const nat = (n) => (lazySrc ? 0 : n);
    return { src: lazySrc || own, w: nat(img.naturalWidth) || r.width || img.width, h: nat(img.naturalHeight) || r.height || img.height };
  });
  const bySize = (a, b) => b.w * b.h - a.w * a.h;
  const sized = onPage.filter((i) => i.w && i.h && i.w >= MIN_SIDE && i.h >= MIN_SIDE).sort(bySize);
  const unknown = onPage.filter((i) => !i.w && !i.h);
  const pictures = sized.concat(unknown).map((i) => i.src);
  const images = [...new Set(declared.concat(pictures).map((u) => (u ? abs(u) : null)).filter(Boolean))].slice(0, MAX_IMAGES);

  return {
    url: doc.location.href,
    title: [meta("og:title"), product?.name, doc.title].map(text).find(Boolean) ?? "",
    price,
    currency,
    images,
  };
}

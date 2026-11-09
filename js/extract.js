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
  const abs = (u) => { try { const x = new URL(u, doc.baseURI); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };

  // JSON-LD: walk every object (arrays, @graph) and collect offers and images.
  const nodes = [];
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") { nodes.push(v); Object.values(v).forEach(walk); }
  };
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try { walk(JSON.parse(s.textContent)); } catch { /* broken JSON-LD is common; skip it */ }
  }
  const offer = nodes.find((n) => n.price != null || n.lowPrice != null);
  const product = nodes.find((n) => [].concat(n["@type"]).includes("Product"));

  const price = meta("product:price:amount", "og:price:amount", "price")
    ?? (offer ? String(offer.price ?? offer.lowPrice) : null)
    ?? doc.querySelector('[itemprop="price"]')?.textContent?.trim() ?? null;
  const currency = meta("product:price:currency", "og:price:currency", "priceCurrency") ?? offer?.priceCurrency ?? null;

  // Images: what the shop declares first, then the page's largest pictures.
  const declared = [meta("og:image:secure_url", "og:image"), meta("twitter:image")]
    .concat([].concat(product?.image ?? []).map((i) => (typeof i === "string" ? i : i?.url)));
  const onPage = [...doc.images]
    .map((img) => ({ src: img.currentSrc || img.src, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height }))
    .filter((i) => i.w >= MIN_SIDE && i.h >= MIN_SIDE)
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .map((i) => i.src);
  const images = [...new Set(declared.concat(onPage).map(abs).filter(Boolean))].slice(0, MAX_IMAGES);

  return {
    url: doc.location.href,
    title: (meta("og:title") ?? product?.name ?? doc.title ?? "").trim(),
    price,
    currency,
    images,
  };
}

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
  const hasPrice = (n) => n && typeof n === "object" && (n.price != null || n.lowPrice != null);
  const products = nodes.filter((n) => [].concat(n["@type"]).includes("Product"));
  const product = products.find((p) => p.offers) ?? products[0];
  // The product's own offer first (object, array, AggregateOffer); the global search is a fallback.
  const offer = [].concat(product?.offers ?? []).find(hasPrice) ?? nodes.find(hasPrice);
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
    title: (meta("og:title") ?? product?.name ?? doc.title ?? "").trim(),
    price,
    currency,
    images,
  };
}

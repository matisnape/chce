// Accepts "1 299,99", "1299.99 zł" and the like; empty or unreadable gives null.
export function parsePrice(text) {
  const cleaned = text.replace(/[^\d,.-]/g, "").replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function formatPrice(price, currency = "PLN") {
  const n = Number(price);
  if (!Number.isFinite(n)) return String(price);
  try { return new Intl.NumberFormat("pl-PL", { style: "currency", currency }).format(n); }
  catch { return `${n} ${currency}`; }
}

// Only http(s) links reach the DOM; anything else (javascript:, data:) is dropped.
export function safeUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch { return null; }
}

// Order for a document appended at the end of a list.
export function nextOrder(list) {
  return list.reduce((max, x) => Math.max(max, x.order ?? 0), 0) + 1;
}

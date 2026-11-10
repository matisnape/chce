// Accepts "1 299,99", "1.299,00", "1299.99 zł" and the like; empty or unreadable gives null.
// Both separators present: the last one is the decimal mark. A lone one followed by exactly
// 3 digits is a thousands separator; otherwise a lone "," is decimal and a lone "." stays decimal.
export function parsePrice(text) {
  let c = text.replace(/[^\d,.-]/g, "");
  const dot = c.lastIndexOf("."), comma = c.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) {
    const dec = Math.max(dot, comma) === dot ? "." : ",";
    c = c.split(dec === "." ? "," : ".").join("").replace(dec, ".");
  } else if (dot >= 0 || comma >= 0) {
    const sep = dot >= 0 ? "." : ",";
    const parts = c.split(sep);
    c = parts.length > 2 || /^\d{3}$/.test(parts[1]) ? parts.join("") : parts.join(".");
  }
  const n = parseFloat(c);
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

// "1 pozycja", "2 pozycje", "5 pozycji", "22 pozycje", "12 pozycji".
export function pluralItems(n) {
  if (n === 1) return "1 pozycja";
  const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20);
  return `${n} ${few ? "pozycje" : "pozycji"}`;
}

// Link as compared for duplicates: host lowercased, "www." and #fragment dropped, utm_*/gclid/fbclid
// dropped, trailing "/" dropped. Other query parameters stay (shops put product ids there).
// Empty or unreadable gives "".
export function normalizeUrl(value) {
  let u;
  try { u = new URL(value); } catch { return ""; }
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$)/i.test(k)) u.searchParams.delete(k);
  return `${u.protocol}//${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
}

// The existing item a new {url, title, tabId} duplicates, or undefined. Two links compare normalised,
// in any tab. With no link on either side, the same title (case and outer spaces ignored) in the same tab.
export function findDuplicate({ url, title, tabId }, items) {
  const key = normalizeUrl(url ?? "");
  const name = title.trim().toLowerCase();
  return items.find((i) => {
    const other = normalizeUrl(i.url ?? "");
    if (key || other) return key === other;
    return i.tabId === tabId && i.title.trim().toLowerCase() === name;
  });
}

export const duplicateText = (item, tabName) => `Taka pozycja już jest: „${item.title}” w zakładce „${tabName}”.`;

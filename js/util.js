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

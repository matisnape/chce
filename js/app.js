import { firebaseConfig, GUEST_EMAIL, LIST_ID, SDK } from "./config.js";

const { initializeApp } = await import(`${SDK}/firebase-app.js`);
const { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider } = await import(`${SDK}/firebase-auth.js`);
const { getFirestore, doc, getDoc, collection, getDocs, query, orderBy } = await import(`${SDK}/firebase-firestore.js`);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => { $(id).hidden = !on; };

// Firebase keeps the session in the browser, so the password is typed once.
onAuthStateChanged(auth, (user) => {
  show("loading", false);
  if (user) { show("gate", false); loadList(); } else { show("gate"); }
});

$("gate").addEventListener("submit", async (e) => {
  e.preventDefault();
  show("gate-error", false);
  try {
    await signInWithEmailAndPassword(auth, GUEST_EMAIL, $("password").value);
  } catch {
    $("gate-error").textContent = "Złe hasło.";
    show("gate-error");
  }
});

// Popup, not redirect: redirect breaks when authDomain differs from anks.pl and third-party storage is blocked.
$("owner-login").addEventListener("click", () => signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => {
  $("gate-error").textContent = `Logowanie nieudane: ${e.code ?? e.message}`;
  show("gate-error");
}));

let tabs = [];
let items = [];

async function loadList() {
  const listRef = doc(db, "lists", LIST_ID);
  const [listSnap, tabSnap, itemSnap] = await Promise.all([
    getDoc(listRef),
    getDocs(query(collection(listRef, "tabs"), orderBy("order"))),
    getDocs(query(collection(listRef, "items"), orderBy("order"))),
  ]);
  if (listSnap.exists() && listSnap.data().title) $("list-title").textContent = listSnap.data().title;
  tabs = tabSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  items = itemSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  show("list");
  render();
}

window.addEventListener("hashchange", render);

function currentTabId() {
  const id = new URLSearchParams(location.hash.slice(1)).get("tab");
  return tabs.some((t) => t.id === id) ? id : tabs[0]?.id;
}

function render() {
  const tabId = currentTabId();
  $("tabs").replaceChildren(...tabs.map((t) => {
    const a = el("a", { href: `#tab=${encodeURIComponent(t.id)}` }, t.name);
    if (t.id === tabId) a.setAttribute("aria-current", "page");
    return a;
  }));
  const tab = tabs.find((t) => t.id === tabId);
  $("tab-description").textContent = tab?.description ?? "";
  const shown = items.filter((i) => i.tabId === tabId);
  $("items").replaceChildren(...shown.map(itemCard));
  show("empty", shown.length === 0);
}

function itemCard(item) {
  const url = safeUrl(item.url);
  const img = safeUrl(item.imageUrl);
  const li = el("li", { class: "item" });
  if (img) li.append(el("img", { src: img, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }));
  const body = el("div", { class: "item-body" });
  body.append(el("h2", {}, url ? el("a", { href: url, rel: "noopener noreferrer", target: "_blank" }, item.title) : item.title));
  if (item.price != null && item.price !== "") body.append(el("p", { class: "price" }, formatPrice(item.price, item.currency)));
  if (item.description) body.append(el("p", { class: "description" }, item.description));
  body.append(findIn(item.title, url));
  li.append(body);
  return li;
}

// "Znajdź w:" as on the original site: the source shop plus price-comparison searches.
function findIn(title, url) {
  const p = el("p", { class: "find-in" }, "Znajdź w: ");
  const q = encodeURIComponent(title ?? "");
  const links = [];
  if (url) links.push([new URL(url).hostname.replace(/^www\./, ""), url]);
  links.push(["Ceneo", `https://www.ceneo.pl/;szukaj-${q}`]);
  links.push(["Google Shopping", `https://www.google.com/search?tbm=shop&q=${q}`]);
  links.forEach(([label, href], i) => {
    if (i) p.append(" · ");
    p.append(el("a", { href, rel: "noopener noreferrer", target: "_blank" }, label));
  });
  return p;
}

function formatPrice(price, currency = "PLN") {
  const n = Number(price);
  if (!Number.isFinite(n)) return String(price);
  try { return new Intl.NumberFormat("pl-PL", { style: "currency", currency }).format(n); }
  catch { return `${n} ${currency}`; }
}

// Only http(s) links reach the DOM; anything else (javascript:, data:) is dropped.
function safeUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch { return null; }
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children.filter((c) => c != null));
  return node;
}

import { firebaseConfig, GUEST_EMAIL, LIST_ID, OWNER_UID, SDK } from "./config.js";
import { parsePrice, formatPrice, safeUrl } from "./util.js";

const { initializeApp } = await import(`${SDK}/firebase-app.js`);
const { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut } = await import(`${SDK}/firebase-auth.js`);
const { getFirestore, doc, getDoc, collection, getDocs, query, orderBy, addDoc, updateDoc, deleteDoc, setDoc, serverTimestamp } = await import(`${SDK}/firebase-firestore.js`);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const listRef = doc(db, "lists", LIST_ID);
const tabsCol = collection(listRef, "tabs");
const itemsCol = collection(listRef, "items");

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => { $(id).hidden = !on; };

let isOwner = false;
let tabs = [];
let items = [];

// ---------- auth ----------

// Firebase keeps the session in the browser, so the password is typed once.
onAuthStateChanged(auth, (user) => {
  show("loading", false);
  isOwner = user?.uid === OWNER_UID;
  document.body.classList.toggle("owner", isOwner);
  show("gate", !user);
  show("logout", !!user);
  if (user) reload();
  else show("list", false);
});

$("gate").addEventListener("submit", async (e) => {
  e.preventDefault();
  show("gate-error", false);
  try {
    await signInWithEmailAndPassword(auth, GUEST_EMAIL, $("password").value);
  } catch {
    showGateError("Złe hasło.");
  }
});

// Popup, not redirect: redirect breaks when authDomain differs from anks.pl and third-party storage is blocked.
$("owner-login").addEventListener("click", () =>
  signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => showGateError(`Logowanie nieudane: ${e.code ?? e.message}`)));

$("logout").addEventListener("click", () => signOut(auth));

function showGateError(text) {
  $("gate-error").textContent = text;
  show("gate-error");
}

// ---------- load and render ----------

async function reload() {
  try {
    const [listSnap, tabSnap, itemSnap] = await Promise.all([
      getDoc(listRef),
      getDocs(query(tabsCol, orderBy("order"))),
      getDocs(query(itemsCol, orderBy("order"))),
    ]);
    $("list-title").textContent = (listSnap.exists() && listSnap.data().title) || "chce";
    tabs = tabSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    items = itemSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  } catch (e) {
    $("list-title").textContent = e.code === "permission-denied" ? "Brak dostępu do listy." : `Błąd: ${e.code ?? e.message}`;
  }
  show("list");
}

window.addEventListener("hashchange", render);

function currentTabId() {
  const id = new URLSearchParams(location.hash.slice(1)).get("tab");
  return tabs.some((t) => t.id === id) ? id : tabs[0]?.id;
}

function render() {
  const tabId = currentTabId();
  $("tabs").replaceChildren(...tabs.map((t) => {
    const a = el("a", { href: `#tab=${encodeURIComponent(t.id)}`, "data-id": t.id }, t.name);
    if (t.id === tabId) a.setAttribute("aria-current", "page");
    if (isOwner) makeDraggable(a, "tab");
    return a;
  }));
  const tab = tabs.find((t) => t.id === tabId);
  $("tab-description").textContent = tab?.description ?? "";
  show("edit-tab", isOwner && !!tab);
  show("add-item", isOwner && !!tab);
  const shown = items.filter((i) => i.tabId === tabId);
  $("items").replaceChildren(...shown.map(itemCard));
  $("empty").textContent = tabs.length ? "Pusto." : isOwner ? "Dodaj pierwszą zakładkę." : "Pusto.";
  show("empty", shown.length === 0);
}

function itemCard(item) {
  const url = safeUrl(item.url);
  const img = safeUrl(item.imageUrl);
  const li = el("li", { class: "item", "data-id": item.id });
  if (img) li.append(el("img", { src: img, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }));
  const body = el("div", { class: "item-body" });
  body.append(el("h2", {}, url ? el("a", { href: url, rel: "noopener noreferrer", target: "_blank" }, item.title) : item.title));
  if (item.price != null && item.price !== "") body.append(el("p", { class: "price" }, formatPrice(item.price, item.currency)));
  if (item.description) body.append(el("p", { class: "description" }, item.description));
  body.append(findIn(item.title, url));
  if (isOwner) {
    const edit = el("button", { type: "button", class: "link" }, "edytuj");
    edit.addEventListener("click", () => openItemForm(item));
    body.append(edit);
    makeDraggable(li, "item");
  }
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

// ---------- owner: tabs ----------

$("add-tab").addEventListener("click", () => openTabForm(null));
$("edit-tab").addEventListener("click", () => openTabForm(tabs.find((t) => t.id === currentTabId())));

function openTabForm(tab) {
  const f = $("tab-form");
  f.dataset.id = tab?.id ?? "";
  f.elements.name.value = tab?.name ?? "";
  f.elements.description.value = tab?.description ?? "";
  show("tab-delete", !!tab);
  $("tab-dialog").showModal();
}

$("tab-form").addEventListener("submit", (e) => submitDialog(e, "tab-dialog", async (f) => {
  const data = { name: f.elements.name.value.trim(), description: f.elements.description.value.trim() };
  if (f.dataset.id) return updateDoc(doc(tabsCol, f.dataset.id), data);
  const ref = await addDoc(tabsCol, { ...data, order: nextOrder(tabs) });
  if (!tabs.length) await setDoc(listRef, { title: "chce" }, { merge: true });
  location.hash = `tab=${ref.id}`;
}));

$("tab-delete").addEventListener("click", () => runAndClose("tab-dialog", async () => {
  const id = $("tab-form").dataset.id;
  if (items.some((i) => i.tabId === id)) return alert("Zakładka ma pozycje. Przenieś je albo usuń najpierw.");
  if (!confirm("Usunąć zakładkę?")) return;
  await deleteDoc(doc(tabsCol, id));
  location.hash = "";
}));

// ---------- owner: items ----------

$("add-item").addEventListener("click", () => openItemForm({ tabId: currentTabId() }));

function openItemForm(item) {
  const f = $("item-form");
  f.dataset.id = item.id ?? "";
  for (const name of ["title", "url", "imageUrl", "description"]) f.elements[name].value = item[name] ?? "";
  f.elements.price.value = item.price ?? "";
  f.elements.currency.value = item.currency ?? "PLN";
  f.elements.tabId.replaceChildren(...tabs.map((t) => el("option", { value: t.id }, t.name)));
  f.elements.tabId.value = item.tabId ?? currentTabId();
  show("item-delete", !!item.id);
  $("item-dialog").showModal();
}

$("item-form").addEventListener("submit", (e) => submitDialog(e, "item-dialog", async (f) => {
  const v = (name) => f.elements[name].value.trim();
  const data = {
    title: v("title"),
    url: safeUrl(v("url")),
    imageUrl: safeUrl(v("imageUrl")),
    price: parsePrice(v("price")),
    currency: v("currency").toUpperCase() || "PLN",
    description: v("description"),
    tabId: v("tabId"),
  };
  const old = items.find((i) => i.id === f.dataset.id);
  if (old) {
    if (old.tabId !== data.tabId) data.order = nextOrder(items.filter((i) => i.tabId === data.tabId));
    return updateDoc(doc(itemsCol, old.id), data);
  }
  await addDoc(itemsCol, { ...data, order: nextOrder(items.filter((i) => i.tabId === data.tabId)), createdAt: serverTimestamp() });
}));

$("item-delete").addEventListener("click", () => runAndClose("item-dialog", async () => {
  if (!confirm("Usunąć pozycję?")) return;
  await deleteDoc(doc(itemsCol, $("item-form").dataset.id));
}));

for (const id of ["tab-dialog", "item-dialog"]) {
  $(id).querySelector("[data-cancel]").addEventListener("click", () => $(id).close());
}

async function submitDialog(e, dialogId, save) {
  e.preventDefault();
  await runAndClose(dialogId, () => save(e.target));
}

async function runAndClose(dialogId, action) {
  try {
    await action();
    if (dialogId) $(dialogId).close();
    await reload();
  } catch (err) {
    alert(`Nie udało się zapisać: ${err.code ?? err.message}`);
  }
}

// ---------- owner: drag and drop ----------
// Order is a number per document; a drop writes one midpoint value, so only the moved document changes.
// ponytail: HTML5 drag and drop does not work on most touch screens; add up/down buttons if reordering on a phone matters.

let dragged = null;

function makeDraggable(node, kind) {
  node.draggable = true;
  node.addEventListener("dragstart", (e) => {
    dragged = { kind, id: node.dataset.id };
    e.dataTransfer.effectAllowed = "move";
  });
  node.addEventListener("dragend", () => { dragged = null; });
  node.addEventListener("dragover", (e) => {
    // Items reorder among items; an item dropped on a tab moves to that tab.
    if (dragged && (dragged.kind === kind || (dragged.kind === "item" && kind === "tab"))) e.preventDefault();
  });
  node.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!dragged || dragged.id === node.dataset.id) return;
    const drag = dragged;
    if (drag.kind === "item" && kind === "tab") return moveItemToTab(drag.id, node.dataset.id);
    const box = node.getBoundingClientRect();
    const after = kind === "tab" ? e.clientX > box.left + box.width / 2 : e.clientY > box.top + box.height / 2;
    reorder(drag.kind, drag.id, node.dataset.id, after);
  });
}

function reorder(kind, movedId, targetId, after) {
  const col = kind === "tab" ? tabsCol : itemsCol;
  const moved = (kind === "tab" ? tabs : items).find((x) => x.id === movedId);
  const list = (kind === "tab" ? tabs : items.filter((i) => i.tabId === moved.tabId)).filter((x) => x.id !== movedId);
  const at = list.findIndex((x) => x.id === targetId) + (after ? 1 : 0);
  const prev = list[at - 1]?.order;
  const next = list[at]?.order;
  const order = prev == null ? (next ?? 0) - 1 : next == null ? prev + 1 : (prev + next) / 2;
  runAndClose(null, () => updateDoc(doc(col, movedId), { order }));
}

function moveItemToTab(itemId, tabId) {
  const order = nextOrder(items.filter((i) => i.tabId === tabId));
  runAndClose(null, () => updateDoc(doc(itemsCol, itemId), { tabId, order }));
}

// ---------- helpers ----------

function nextOrder(list) {
  return list.reduce((max, x) => Math.max(max, x.order ?? 0), 0) + 1;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children.filter((c) => c != null));
  return node;
}

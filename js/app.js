import { GUEST_EMAIL, OWNER_UID } from "./config.js";
import { parsePrice, formatPrice, safeUrl, nextOrder, pluralItems } from "./util.js";
import { auth, fbAuth, fbStore, listRef, tabsCol, itemsCol, signInOwnerWithGoogle } from "./firebase.js";

const { onAuthStateChanged, signInWithEmailAndPassword, signOut } = fbAuth;
const { doc, getDoc, getDocs, query, orderBy, addDoc, updateDoc, deleteDoc, setDoc, serverTimestamp } = fbStore;

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

$("owner-login").addEventListener("click", () =>
  signInOwnerWithGoogle().catch((e) => showGateError(`Logowanie nieudane: ${e.code ?? e.message}`)));

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
    setBrand((listSnap.exists() && listSnap.data().title) || "chce");
    tabs = tabSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    items = itemSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  } catch (e) {
    setBrand(e.code === "permission-denied" ? "Brak dostępu do listy." : `Błąd: ${e.code ?? e.message}`);
  }
  show("list");
}

window.addEventListener("hashchange", render);

function setBrand(text) {
  for (const n of document.querySelectorAll(".brand-name")) n.textContent = text;
}

// null means the All view: no hash, or a hash that names no tab.
function currentTabId() {
  const id = new URLSearchParams(location.hash.slice(1)).get("tab");
  return tabs.some((t) => t.id === id) ? id : null;
}

const IMAGE_ICON = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>';
const PENCIL_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
const PHONE_CHIPS = 4; // "Wszystko" counts as one; the rest hide behind "+N więcej" on narrow screens (see style.css)

let moreOpen = false;

function render() {
  const tabId = currentTabId();
  const tab = tabs.find((t) => t.id === tabId);
  const countIn = (id) => items.filter((i) => i.tabId === id).length;

  const nav = [el("a", { href: "#", "data-id": "all" }, el("span", { class: "name" }, "Wszystko"), el("span", { class: "count" }, String(items.length)))];
  for (const t of tabs) {
    const a = el("a", { href: `#tab=${encodeURIComponent(t.id)}`, "data-id": t.id }, el("span", { class: "name" }, t.name), el("span", { class: "count" }, String(countIn(t.id))));
    if (isOwner) makeDraggable(a, "tab");
    nav.push(a);
  }
  nav.find((a) => a.dataset.id === (tabId ?? "all")).setAttribute("aria-current", "page");
  const hiddenChips = nav.length - PHONE_CHIPS;
  const more = el("button", { type: "button", id: "tabs-more", "aria-expanded": String(moreOpen) }, moreOpen ? "Mniej" : `+${hiddenChips} więcej`);
  more.hidden = hiddenChips <= 0;
  more.addEventListener("click", () => { moreOpen = !moreOpen; render(); });
  $("tabs").classList.toggle("expanded", moreOpen);
  $("tabs").replaceChildren(...nav, more);

  const shown = tab ? [tab] : tabs;
  const shownCount = tab ? countIn(tab.id) : items.length;
  $("view-title").textContent = tab ? tab.name : "Wszystko";
  $("view-count").textContent = pluralItems(shownCount);
  $("tab-description").textContent = tab?.description ?? "";
  $("edit-tab").textContent = tab ? `Edytuj zakładkę „${tab.name}”` : "";
  show("edit-tab", !!tab);
  show("add-item", isOwner && tabs.length > 0);
  $("sections").replaceChildren(...shown.map((t) => {
    const section = el("section", { class: "tab-section" });
    const mine = items.filter((i) => i.tabId === t.id);
    if (!tab) section.append(el("div", { class: "section-head" }, el("h2", {}, t.name), el("span", {}, pluralItems(mine.length))));
    if (mine.length) section.append(el("ul", { class: "items" }, ...mine.map(itemCard)));
    return section;
  }));
  $("empty").textContent = tabs.length ? "Pusto." : isOwner ? "Dodaj pierwszą zakładkę." : "Pusto.";
  show("empty", shownCount === 0);
}

function itemCard(item) {
  const url = safeUrl(item.url);
  const img = safeUrl(item.imageUrl);
  const li = el("li", { class: "item", "data-id": item.id });
  const tile = el("div", { class: "tile" });
  if (img) tile.append(el("img", { src: img, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }));
  else tile.insertAdjacentHTML("beforeend", IMAGE_ICON);
  li.append(tile);
  const body = el("div", { class: "item-body" });
  body.append(el("h3", {}, url ? el("a", { href: url, rel: "noopener noreferrer", target: "_blank" }, item.title) : item.title));
  if (item.price != null && item.price !== "") body.append(el("p", { class: "price" }, formatPrice(item.price, item.currency)));
  if (item.description) body.append(el("p", { class: "description" }, item.description));
  body.append(findIn(item.title, url));
  li.append(body);
  if (isOwner) {
    const edit = el("button", { type: "button", class: "icon-btn item-edit", "aria-label": "Edytuj pozycję" });
    edit.insertAdjacentHTML("beforeend", PENCIL_ICON);
    edit.addEventListener("click", () => openItemForm(item));
    li.append(edit);
    makeDraggable(li, "item");
  }
  return li;
}

// "Znajdź w:" as on the original site: the source shop plus price-comparison searches.
function findIn(title, url) {
  const p = el("p", { class: "find-in" }, "Znajdź w: ");
  const q = encodeURIComponent(title ?? "");
  const links = [];
  if (url) links.push([new URL(url).hostname.replace(/^www\./, ""), url]);
  links.push(["Ceneo", `https://www.ceneo.pl/;szukaj-${q}`]);
  links.push(["Allegro", `https://allegro.pl/listing?string=${q}`]);
  links.push(["Google Shopping", `https://www.google.com/search?tbm=shop&q=${q}`]);
  links.forEach(([label, href], i) => {
    if (i) p.append(" · ");
    p.append(el("a", { href, rel: "noopener noreferrer", target: "_blank" }, label));
  });
  return p;
}

// ---------- owner: tabs ----------

$("add-tab").addEventListener("click", () => { closeMenu(); openTabForm(null); });
$("edit-tab").addEventListener("click", () => { closeMenu(); openTabForm(tabs.find((t) => t.id === currentTabId())); });

// ---------- sidebar toggle and the ⋯ menu ----------

$("sidebar-toggle").addEventListener("click", () => {
  const closed = $("list").classList.toggle("sidebar-closed");
  $("sidebar-toggle").setAttribute("aria-expanded", String(!closed));
});

function closeMenu(refocus = false) {
  show("tabs-menu", false);
  $("tabs-menu-btn").setAttribute("aria-expanded", "false");
  if (refocus) $("tabs-menu-btn").focus();
}

$("tabs-menu-btn").addEventListener("click", () => {
  const open = $("tabs-menu").hidden;
  show("tabs-menu", open);
  $("tabs-menu-btn").setAttribute("aria-expanded", String(open));
  if (open) $("tabs-menu").querySelector("button:not([hidden])").focus();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("tabs-menu").hidden) closeMenu(true); });
document.addEventListener("click", (e) => { if (!$("tabs-menu").hidden && !e.target.closest(".side-head")) closeMenu(); });

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

$("add-item").addEventListener("click", () => openItemForm({ tabId: currentTabId() ?? tabs[0]?.id }));

function openItemForm(item) {
  const f = $("item-form");
  f.dataset.id = item.id ?? "";
  for (const name of ["title", "url", "imageUrl", "description"]) f.elements[name].value = item[name] ?? "";
  f.elements.price.value = item.price ?? "";
  f.elements.currency.value = item.currency ?? "PLN";
  f.elements.tabId.replaceChildren(...tabs.map((t) => el("option", { value: t.id }, t.name)));
  f.elements.tabId.value = item.tabId ?? currentTabId() ?? tabs[0]?.id;
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
  // In the All view an item can be dropped on an item of another tab: that is not a reorder.
  if (kind === "item" && items.find((i) => i.id === targetId)?.tabId !== moved.tabId) return;
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

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children.filter((c) => c != null));
  return node;
}

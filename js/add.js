// The add popup: the bookmarklet opens it with the shop page's data in the URL hash.
// Without a hash it is a plain manual add form.
import { OWNER_UID, EMULATOR } from "./config.js";
import { parsePrice, safeUrl, nextOrder } from "./util.js";
import { auth, fbAuth, fbStore, tabsCol, itemsCol, signInOwnerWithGoogle } from "./firebase.js";

const { getDocs, query, orderBy, where, addDoc, serverTimestamp } = fbStore;
const $ = (id) => document.getElementById(id);
const show = (id, on = true) => { $(id).hidden = !on; };
const form = $("add-form");
const MAX_URL = 2048;
const LAST_TAB = "chce:lastTab";

let page = readHash();
let filled = false; // the form is filled once; later auth events must not reset the user's edits

const fail = (text) => { $("add-error").textContent = text; show("add-error"); };

fbAuth.onAuthStateChanged(auth, async (user) => {
  show("loading", false);
  const owner = user?.uid === OWNER_UID;
  show("signin", !owner);
  if (!owner) { show("add-form", false); return; }
  if (filled) { show("add-form"); return; }
  filled = true;
  try { await fillForm(); } catch (e) { fail(`Nie udało się wczytać formularza: ${e.code ?? e.message}`); }
});

$("owner-login").addEventListener("click", () => signInOwnerWithGoogle().catch((e) => {
  $("signin-error").textContent = `Logowanie nieudane: ${e.code ?? e.message}`;
  show("signin-error");
}));

// The hash comes from whatever page the bookmarklet ran on, so this is the only guard on it:
// keep known fields of the right type and length. The description is never taken from it.
function readHash() {
  try {
    const d = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
    const url = (v) => (typeof v === "string" && v.length <= MAX_URL ? safeUrl(v) : null);
    return {
      url: url(d.url) ?? "", title: str(d.title, 200), price: str(d.price, 32), currency: str(d.currency, 3),
      images: Array.isArray(d.images) ? d.images.map(url).filter(Boolean).slice(0, 8) : [],
    };
  } catch {
    return { url: "", title: "", price: "", currency: "", images: [] };
  }
}

async function fillForm() {
  const tabs = (await getDocs(query(tabsCol, orderBy("order")))).docs.map((d) => ({ id: d.id, ...d.data() }));
  const select = form.elements.tabId;
  select.replaceChildren(...tabs.map((t) => new Option(t.name, t.id)));
  let last = null;
  try { last = localStorage.getItem(LAST_TAB); } catch { /* storage may be blocked */ }
  if (tabs.some((t) => t.id === last)) select.value = last;

  fillFields();
}

function fillFields() {
  form.elements.title.value = page.title;
  form.elements.url.value = safeUrl(page.url) ?? "";
  const price = parsePrice(page.price);
  form.elements.price.value = price ?? "";
  if (/^[A-Za-z]{3}$/.test(page.currency)) form.elements.currency.value = page.currency.toUpperCase();
  form.elements.customImage.value = "";
  show("saved", false);

  const choices = page.images.map((src, i) => imageChoice(src, i === 0));
  choices.push(imageChoice(null, page.images.length === 0));
  $("images").replaceChildren(...choices);
  show("add-form");
}

function imageChoice(src, checked) {
  const label = document.createElement("label");
  const radio = Object.assign(document.createElement("input"), { type: "radio", name: "image", value: src ?? "", checked });
  label.append(radio);
  if (src) {
    label.append(Object.assign(document.createElement("img"), { src, alt: "", referrerPolicy: "no-referrer" }));
  } else {
    label.append(Object.assign(document.createElement("span"), { className: "none", textContent: "bez zdjęcia" }));
  }
  return label;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  show("add-error", false);
  const v = (name) => form.elements[name].value.trim();
  const tabId = v("tabId");
  try {
    const inTab = (await getDocs(query(itemsCol, where("tabId", "==", tabId)))).docs.map((d) => d.data());
    await addDoc(itemsCol, {
      tabId,
      title: v("title"),
      url: safeUrl(v("url")),
      imageUrl: safeUrl(v("customImage")) ?? safeUrl(form.elements.image.value),
      price: parsePrice(v("price")),
      currency: v("currency").toUpperCase() || "PLN",
      description: v("description"),
      order: nextOrder(inTab),
      createdAt: serverTimestamp(),
    });
    try { localStorage.setItem(LAST_TAB, tabId); } catch { /* storage may be blocked */ }
    show("add-form", false);
    $("saved-link").href = `./${EMULATOR ? "?emulator" : ""}#tab=${encodeURIComponent(tabId)}`;
    show("saved");
    if (new URLSearchParams(location.search).has("popup")) setTimeout(() => window.close(), 1500);
  } catch (err) {
    $("add-error").textContent = `Nie udało się zapisać: ${err.code ?? err.message}`;
    show("add-error");
  }
});

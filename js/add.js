// The add popup: the bookmarklet opens it with the shop page's data in the URL hash.
// Without a hash it is a plain manual add form.
import { OWNER_UID, EMULATOR, WORKER_URL } from "./config.js";
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
  try { return clean(JSON.parse(decodeURIComponent(location.hash.slice(1)))); } catch { return clean({}); }
}

// Same guard for every source of page data (hash, Worker): known fields, right type and length.
function clean(d) {
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const url = (v) => (typeof v === "string" && v.length <= MAX_URL ? safeUrl(v) : null);
  return {
    url: url(d?.url) ?? "", title: str(d?.title, 200), price: str(d?.price, 32), currency: str(d?.currency, 3),
    images: Array.isArray(d?.images) ? d.images.map(url).filter(Boolean).slice(0, 8) : [],
  };
}

async function fillForm() {
  const tabs = (await getDocs(query(tabsCol, orderBy("order")))).docs.map((d) => ({ id: d.id, ...d.data() }));
  const select = form.elements.tabId;
  select.replaceChildren(...tabs.map((t) => new Option(t.name, t.id)));
  let last = null;
  try { last = localStorage.getItem(LAST_TAB); } catch { /* storage may be blocked */ }
  if (tabs.some((t) => t.id === last)) select.value = last;

  fillFields(page);
}

// Fills the form from page data (hash or Worker). Rule: only empty fields are filled, so what the
// owner already typed is never overwritten. Currency follows the price, images only come in when
// none is offered yet and no custom image URL is typed.
function fillFields(d) {
  const f = form.elements;
  const priceWasEmpty = !f.price.value.trim();
  if (!f.title.value.trim()) f.title.value = d.title;
  if (!f.url.value.trim()) f.url.value = safeUrl(d.url) ?? "";
  const price = parsePrice(d.price);
  if (priceWasEmpty) f.price.value = price ?? "";
  if (priceWasEmpty && /^[A-Za-z]{3}$/.test(d.currency)) f.currency.value = d.currency.toUpperCase();
  show("saved", false);

  const noImages = ![...$("images").querySelectorAll('input[name="image"]')].some((r) => r.value) && !f.customImage.value.trim();
  if (noImages) {
    const choices = d.images.map((src, i) => imageChoice(src, i === 0));
    choices.push(imageChoice(null, d.images.length === 0));
    $("images").replaceChildren(...choices);
  }
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

// --- fetch from a pasted link (phone flow, decisions 17 and 18) ---

const FETCH_TIMEOUT_MS = EMULATOR ? Number(new URLSearchParams(location.search).get("fetchTimeout")) || 10_000 : 10_000;
const fetchBtn = $("fetch-link");
const note = (text, isError = false) => {
  const el = $("fetch-status");
  el.textContent = text;
  el.className = isError ? "error" : "";
  el.hidden = !text;
};

const WORKER_ERRORS = {
  400: "Ten link nie wygląda na stronę sklepu. Sprawdź adres.",
  401: "Sesja wygasła. Zaloguj się ponownie i spróbuj jeszcze raz.",
  403: "To konto nie może pobierać danych z linków.",
  502: "Sklep nie oddał strony (może blokować boty). Wpisz dane ręcznie.",
  503: "Usługa chwilowo niedostępna. Spróbuj za chwilę albo wpisz dane ręcznie.",
};

fetchBtn.addEventListener("click", async () => {
  if (fetchBtn.disabled) return;
  const link = safeUrl(form.elements.url.value.trim());
  if (!link) { note("Wklej poprawny link do sklepu (https://…).", true); return; }
  fetchBtn.disabled = true;
  note("Pobieram dane…");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(WORKER_URL + "/extract", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: link }),
      signal: ctl.signal,
    });
    if (!res.ok) { note(WORKER_ERRORS[res.status] ?? `Nie udało się pobrać danych (błąd ${res.status}). Wpisz dane ręcznie.`, true); return; }
    const got = clean(await res.json());
    if (!got.title && !got.price && !got.images.length) { note("Nic nie znaleziono na tej stronie. Wpisz dane ręcznie.", true); return; }
    fillFields(got);
    note("Dane pobrane. Uzupełniono tylko puste pola; sprawdź i zapisz.");
  } catch (e) {
    note(ctl.signal.aborted ? "Pobieranie trwa za długo. Spróbuj jeszcze raz albo wpisz dane ręcznie."
      : "Brak połączenia z usługą pobierania. Wpisz dane ręcznie.", true);
  } finally {
    clearTimeout(timer);
    fetchBtn.disabled = false;
  }
});

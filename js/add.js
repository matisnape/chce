// The add popup: the bookmarklet opens it with the shop page's data in the URL hash.
// Without a hash it is a plain manual add form.
import { OWNER_UID, EMULATOR, WORKER_URL } from "./config.js";
import { parsePrice, safeUrl, nextOrder, findDuplicate, duplicateText } from "./util.js";
import { auth, fbAuth, fbStore, tabsCol, itemsCol, signInOwnerWithGoogle } from "./firebase.js";

const { getDocs, query, orderBy, addDoc, serverTimestamp } = fbStore;
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

// What the last fetch put into each field. A field is overwritten only while it is empty or still
// holds that value, so a hand edit is never lost and a corrected link can replace the first result.
const last = { title: "", price: "", currency: "", images: [] };

// Fills the form from page data (hash or Worker) and says whether anything changed. `track` (the
// Worker path) records what it wrote; the hash fill is not tracked, so a fetch never replaces it.
// Currency follows the price. Images come in when none is offered or the offered ones are the last
// fetch's with the first still picked, and no custom image URL is typed.
function fillFields(d, track = false) {
  const f = form.elements;
  let changed = false;
  const set = (el, val) => { if (el.value !== val) changed = true; el.value = val; };
  const free = (el, prev, ...also) => { const v = el.value.trim(); return !v || also.includes(v) || (track && v === prev); };

  if (free(f.title, last.title)) { set(f.title, d.title); if (track) last.title = f.title.value; }
  if (!f.url.value.trim()) set(f.url, safeUrl(d.url) ?? "");
  const priceFree = free(f.price, last.price);
  if (priceFree) {
    set(f.price, parsePrice(d.price) ?? "");
    if (track) last.price = f.price.value;
    // The default counts as free only until a fetch has set the currency, so a hand-typed default stays.
    const def = f.currency.defaultValue;
    if (free(f.currency, last.currency, ...(track && last.currency ? [] : [def]))) {
      const cur = /^[A-Za-z]{3}$/.test(d.currency) ? d.currency.toUpperCase() : def; // no valid currency: drop a stale one
      set(f.currency, cur);
      if (track) last.currency = cur === def ? "" : cur;
    }
  }
  show("saved", false);

  const radios = [...$("images").querySelectorAll('input[name="image"]')];
  const shown = radios.map((r) => r.value).filter(Boolean);
  const picked = radios.find((r) => r.checked)?.value ?? "";
  const imagesFree = !f.customImage.value.trim() &&
    (!shown.length || (track && shown.join("\n") === last.images.join("\n") && picked === (last.images[0] ?? "")));
  if (imagesFree) {
    if (shown.join("\n") !== d.images.join("\n")) changed = true;
    const choices = d.images.map((src, i) => imageChoice(src, i === 0));
    choices.push(imageChoice(null, d.images.length === 0));
    $("images").replaceChildren(...choices);
    if (track) last.images = d.images;
  }
  show("add-form");
  return changed;
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

const fetchBtn = $("fetch-link");
const saveBtn = form.querySelector('button[type="submit"]');
let running = null; // AbortController of the fetch in flight, if any

let dupConfirmed = false;
form.addEventListener("input", () => show("dup-warning", false));
$("dup-cancel").addEventListener("click", () => show("dup-warning", false));
$("dup-confirm").addEventListener("click", () => { dupConfirmed = true; form.requestSubmit(); });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const confirmed = dupConfirmed;
  dupConfirmed = false;
  if (saveBtn.disabled) return;
  saveBtn.disabled = fetchBtn.disabled = true; // one save at a time, and no fetch fills fields meanwhile
  running?.abort("saving"); // a late Worker reply must not refill the form after the save
  show("add-error", false);
  const v = (name) => form.elements[name].value.trim();
  const tabId = v("tabId");
  try {
    const all = (await getDocs(itemsCol)).docs.map((d) => d.data());
    const dup = !confirmed && findDuplicate({ url: v("url"), title: v("title"), tabId }, all);
    if (dup) {
      const tabName = form.elements.tabId.querySelector(`option[value="${CSS.escape(dup.tabId)}"]`)?.textContent ?? "?";
      $("dup-warning").firstElementChild.textContent = duplicateText(dup, tabName);
      show("dup-warning");
      saveBtn.disabled = fetchBtn.disabled = false;
      return;
    }
    const inTab = all.filter((i) => i.tabId === tabId);
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
    saveBtn.disabled = fetchBtn.disabled = false;
  }
});

// --- fetch from a pasted link (phone flow, decisions 17 and 18) ---

const FETCH_TIMEOUT_MS = EMULATOR ? Number(new URLSearchParams(location.search).get("fetchTimeout")) || 10_000 : 10_000;
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
  running = ctl;
  const timer = setTimeout(() => ctl.abort("timeout"), FETCH_TIMEOUT_MS);
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch(WORKER_URL + "/extract", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: link }),
      signal: ctl.signal,
    });
    ctl.signal.throwIfAborted();
    if (!res.ok) { note(WORKER_ERRORS[res.status] ?? `Nie udało się pobrać danych (błąd ${res.status}). Wpisz dane ręcznie.`, true); return; }
    const got = clean(await res.json());
    ctl.signal.throwIfAborted();
    if (!got.title && !got.price && !got.images.length) { note("Nic nie znaleziono na tej stronie. Wpisz dane ręcznie.", true); return; }
    note(fillFields(got, true) ? "Dane pobrane. Uzupełniono tylko pola bez ręcznych zmian; sprawdź i zapisz."
      : "Pola są już wypełnione, nic nie zmieniono.");
  } catch (e) {
    if (ctl.signal.reason === "saving") { note(""); return; }
    note(ctl.signal.aborted ? "Pobieranie trwa za długo. Spróbuj jeszcze raz albo wpisz dane ręcznie."
      : "Brak połączenia z usługą pobierania. Wpisz dane ręcznie.", true);
  } finally {
    clearTimeout(timer);
    if (running === ctl) running = null;
    fetchBtn.disabled = saveBtn.disabled; // stays off while a save runs
  }
});

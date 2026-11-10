// The add popup: the bookmarklet opens it with the shop page's data in the URL hash.
// Without a hash it is a plain manual add form.
import { OWNER_UID, EMULATOR } from "./config.js";
import { parsePrice, safeUrl, nextOrder, findDuplicate, duplicateText } from "./util.js";
import { clean, setupLinkFetch } from "./fetch-link.js";
import { auth, fbAuth, fbStore, tabsCol, itemsCol, signInOwnerWithGoogle } from "./firebase.js";

const { getDocs, query, orderBy, addDoc, serverTimestamp } = fbStore;
const $ = (id) => document.getElementById(id);
const show = (id, on = true) => { $(id).hidden = !on; };
const form = $("add-form");
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

async function fillForm() {
  const tabs = (await getDocs(query(tabsCol, orderBy("order")))).docs.map((d) => ({ id: d.id, ...d.data() }));
  const select = form.elements.tabId;
  select.replaceChildren(...tabs.map((t) => new Option(t.name, t.id)));
  let last = null;
  try { last = localStorage.getItem(LAST_TAB); } catch { /* storage may be blocked */ }
  if (tabs.some((t) => t.id === last)) select.value = last;

  fetcher.fill(page);
}

const fetchBtn = $("fetch-link");
const saveBtn = form.querySelector('button[type="submit"]');

const note = (text, isError = false) => {
  const el = $("fetch-status");
  el.textContent = text;
  el.className = isError ? "error" : "";
  el.hidden = !text;
};
const fetcher = setupLinkFetch({
  form, button: fetchBtn, images: $("images"), custom: "customImage", note, busy: () => saveBtn.disabled,
  afterFill: () => { show("saved", false); show("add-form"); },
});

let dupConfirmed = false;
form.addEventListener("input", () => show("dup-warning", false));
$("dup-cancel").addEventListener("click", () => { show("dup-warning", false); saveBtn.focus(); });
$("dup-confirm").addEventListener("click", () => { dupConfirmed = true; form.requestSubmit(); });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const confirmed = dupConfirmed;
  dupConfirmed = false;
  if (saveBtn.disabled) return;
  saveBtn.disabled = fetchBtn.disabled = true; // one save at a time, and no fetch fills fields meanwhile
  fetcher.cancel("saving"); // a late Worker reply must not refill the form after the save
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
      $("dup-confirm").focus();
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

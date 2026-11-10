// Fill a form from a pasted shop link via the Worker. Shared by the add popup (add.js) and the
// item dialog (app.js), so the request, the timeout, the Polish errors and the "fill only
// untouched fields" rule live in one place.
import { EMULATOR, WORKER_URL } from "./config.js";
import { parsePrice, safeUrl } from "./util.js";
import { auth } from "./firebase.js";

const MAX_URL = 2048;
const FETCH_TIMEOUT_MS = EMULATOR ? Number(new URLSearchParams(location.search).get("fetchTimeout")) || 10_000 : 10_000;

const WORKER_ERRORS = {
  400: "Ten link nie wygląda na stronę sklepu. Sprawdź adres.",
  401: "Sesja wygasła. Zaloguj się ponownie i spróbuj jeszcze raz.",
  403: "To konto nie może pobierać danych z linków.",
  502: "Sklep nie oddał strony (może blokować boty). Wpisz dane ręcznie.",
  503: "Usługa chwilowo niedostępna. Spróbuj za chwilę albo wpisz dane ręcznie.",
};

// Same guard for every source of page data (hash, Worker): known fields, right type and length.
export function clean(d) {
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const url = (v) => (typeof v === "string" && v.length <= MAX_URL ? safeUrl(v) : null);
  return {
    url: url(d?.url) ?? "", title: str(d?.title, 200), price: str(d?.price, 32), currency: str(d?.currency, 3),
    images: Array.isArray(d?.images) ? d.images.map(url).filter(Boolean).slice(0, 8) : [],
  };
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

// Wires `button` to fetch the link in `form.elements.url` and fill the form.
//   form, images (container of the radios), custom (name of the own-image-link field)
//   note(text, isError), busy() (true while a save runs), afterFill() (e.g. reveal the form)
//   syncCustom: the picked radio is also written into the custom field (item dialog)
// Returns { fill, cancel, reset }.
export function setupLinkFetch({ form, button, images, custom, note, busy = () => false, afterFill = () => {}, syncCustom = false }) {
  const f = form.elements;
  let running = null; // AbortController of the fetch in flight, if any

  // What the last fetch put into each field. A field is overwritten only while it is empty or still
  // holds that value, so a hand edit is never lost and a corrected link can replace the first result.
  let last;
  const resetLast = () => { last = { title: "", price: "", currency: "", images: [] }; };
  resetLast();

  const radios = () => [...images.querySelectorAll('input[name="image"]')];
  if (syncCustom) images.addEventListener("change", () => { f[custom].value = radios().find((r) => r.checked)?.value ?? ""; });

  // Fills the form from page data (hash or Worker) and says whether anything changed. `track` (the
  // Worker path) records what it wrote; the hash fill is not tracked, so a fetch never replaces it.
  // Currency follows the price. Images come in when none is offered or the offered ones are the last
  // fetch's with the first still picked, and no custom image URL is typed.
  function fill(d, track = false) {
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

    const shown = radios().map((r) => r.value).filter(Boolean);
    const picked = radios().find((r) => r.checked)?.value ?? "";
    const typed = f[custom].value.trim();
    // In the dialog the picked radio is mirrored into the field, so only a different value was typed.
    const customTyped = typed && !(syncCustom && typed === picked);
    const imagesFree = !customTyped &&
      (!shown.length || (track && shown.join("\n") === last.images.join("\n") && picked === (last.images[0] ?? "")));
    if (imagesFree) {
      if (shown.join("\n") !== d.images.join("\n")) changed = true;
      const choices = d.images.map((src, i) => imageChoice(src, i === 0));
      choices.push(imageChoice(null, d.images.length === 0));
      images.replaceChildren(...choices);
      if (syncCustom) f[custom].value = d.images[0] ?? "";
      if (track) last.images = d.images;
    }
    afterFill();
    return changed;
  }

  button.addEventListener("click", async () => {
    if (button.disabled) return;
    const link = safeUrl(f.url.value.trim());
    if (!link) { note("Wklej poprawny link do sklepu (https://…).", true); return; }
    button.disabled = true;
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
      note(fill(got, true) ? "Dane pobrane. Uzupełniono tylko pola bez ręcznych zmian; sprawdź i zapisz."
        : "Pola są już wypełnione, nic nie zmieniono.");
    } catch (e) {
      if (ctl.signal.aborted && ctl.signal.reason !== "timeout") { note(""); return; } // saved or closed meanwhile
      note(ctl.signal.aborted ? "Pobieranie trwa za długo. Spróbuj jeszcze raz albo wpisz dane ręcznie."
        : "Brak połączenia z usługą pobierania. Wpisz dane ręcznie.", true);
    } finally {
      clearTimeout(timer);
      if (running === ctl) running = null;
      button.disabled = busy(); // stays off while a save runs
    }
  });

  return {
    fill,
    // A save or a closing dialog wins: a late Worker reply must not refill the form.
    cancel: (reason) => running?.abort(reason),
    // A fresh dialog starts with nothing remembered from the last fetch.
    reset() { running?.abort("closed"); resetLast(); images.replaceChildren(); note(""); button.disabled = false; },
  };
}

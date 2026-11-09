// Helpers that talk to the Firebase emulators directly. "Bearer owner" is the
// emulators' admin token: it bypasses security rules, like the Admin SDK.
import { readFileSync } from "node:fs";
import { OWNER_UID } from "../../js/config.js";

// The UIDs come from firestore.rules, so the tests exercise the rules as deployed.
const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
const uidIn = (fn) => rules.match(new RegExp(`${fn}\\(\\) \\{ return '([^']+)'`))[1];

export const PROJECT = "demo-chce";
export const GUEST_UID = uidIn("guestUid");
if (uidIn("ownerUid") !== OWNER_UID) throw new Error("OWNER_UID in js/config.js differs from firestore.rules");
export const OWNER = { uid: OWNER_UID, email: "owner@test.local", password: "owner-pass-1" };
export const GUEST = { uid: GUEST_UID, email: "guest@anks.pl", password: "guest-pass-1" };
const AUTH = "http://127.0.0.1:9099";
const FS = "http://127.0.0.1:8085";
const DOCS = `${FS}/v1/projects/${PROJECT}/databases/(default)/documents`;
const admin = { Authorization: "Bearer owner", "Content-Type": "application/json" };

export async function reset() {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  for (const u of [OWNER, GUEST]) {
    const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`, {
      method: "POST", headers: admin,
      body: JSON.stringify({ localId: u.uid, email: u.email, password: u.password }),
    });
    if (!r.ok) throw new Error(`seed user ${u.email}: ${r.status} ${await r.text()}`);
  }
}

const toFields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) =>
  [k, typeof v === "number" ? { doubleValue: v } : v === null ? { nullValue: null } : { stringValue: String(v) }]));

export async function seedDoc(path, data) {
  const r = await fetch(`${DOCS}/${path}`, { method: "PATCH", headers: admin, body: JSON.stringify({ fields: toFields(data) }) });
  if (!r.ok) throw new Error(`seed ${path}: ${r.status} ${await r.text()}`);
}

// A request as a given user (or anonymous when token is null); returns the HTTP status.
export async function asUser(token, method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${DOCS}/${path}`, { method, headers, body: body && JSON.stringify({ fields: toFields(body) }) });
  return r.status;
}

export async function signIn(email, password) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return (await r.json()).idToken;
}

export async function signUpStranger() {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "stranger@test.local", password: "stranger-1", returnSecureToken: true }),
  });
  return (await r.json()).idToken;
}

export async function seedList() {
  await seedDoc("lists/main", { title: "chce" });
  await seedDoc("lists/main/tabs/books", { name: "Książki", description: "Do czytania", order: 1 });
  await seedDoc("lists/main/tabs/have", { name: "Już mam", description: "", order: 2 });
  await seedDoc("lists/main/items/a", { tabId: "books", title: "Książka A", url: "https://shop.example/a", imageUrl: null, price: 49.9, currency: "PLN", description: "twarda okładka", order: 1 });
  await seedDoc("lists/main/items/b", { tabId: "books", title: "Książka B", url: "https://shop.example/b", imageUrl: null, price: null, currency: "PLN", description: "", order: 2 });
}

// Ids of the documents in a collection under lists/main, read as admin.
export async function listIds(collection) {
  const r = await fetch(`${DOCS}/lists/main/${collection}?pageSize=100`, { headers: admin });
  return ((await r.json()).documents ?? []).map((d) => d.name.split("/").pop());
}

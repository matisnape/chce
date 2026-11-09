// Firebase web config is public by design: access is enforced by firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyA6lkAdFm1UQVf1kVHhmuDQSAcwsuBxtUw",
  authDomain: "chceto-843ed.firebaseapp.com",
  projectId: "chceto-843ed",
  appId: "1:342079560786:web:4616e66666bc9f13a9138b",
};

// The shared guest account: the guest password is this account's password.
// UIDs are identifiers, not credentials; firestore.rules holds the same values.
export const OWNER_UID = "bfKB1t30oIcRYkswE73omAIvpok1";

export const GUEST_EMAIL = "guest@anks.pl";

// One list for now; the data model keeps room for more.
export const LIST_ID = "main";

// The Cloudflare Worker that fetches a shop page for the owner (docs/decisions.md 17, 18).
export const WORKER_URL = "https://chce.anks14.workers.dev";

export const SDK = "https://www.gstatic.com/firebasejs/13.1.0";

// Tests run against the Firebase emulators: only on localhost, only with ?emulator in the URL.
export const EMULATOR = typeof location !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("emulator");

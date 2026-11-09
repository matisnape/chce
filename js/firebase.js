// One Firebase setup shared by every page. In emulator mode (tests) it talks to the local emulators.
import { firebaseConfig, LIST_ID, SDK, EMULATOR } from "./config.js";

const fbApp = await import(`${SDK}/firebase-app.js`);
export const fbAuth = await import(`${SDK}/firebase-auth.js`);
export const fbStore = await import(`${SDK}/firebase-firestore.js`);

const app = fbApp.initializeApp(EMULATOR ? { ...firebaseConfig, projectId: "demo-chce" } : firebaseConfig);
export const auth = fbAuth.getAuth(app);
export const db = fbStore.getFirestore(app);
if (EMULATOR) {
  fbAuth.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  fbStore.connectFirestoreEmulator(db, "127.0.0.1", 8085);
  // The Google popup cannot run headless; rules check only the UID, so tests sign the owner in by password.
  window.__signInOwner = (email, password) => fbAuth.signInWithEmailAndPassword(auth, email, password);
  window.__signOut = () => fbAuth.signOut(auth);
}

export const listRef = fbStore.doc(db, "lists", LIST_ID);
export const tabsCol = fbStore.collection(listRef, "tabs");
export const itemsCol = fbStore.collection(listRef, "items");

// Popup, not redirect: redirect breaks when authDomain differs from anks.pl and third-party storage is blocked.
export const signInOwnerWithGoogle = () => fbAuth.signInWithPopup(auth, new fbAuth.GoogleAuthProvider());

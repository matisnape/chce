// Builds the bookmarklet from js/extract.js, so the code on the shop page is the tested code.
// Page data travels in the popup URL's hash: no postMessage, so a shop's opener policy cannot cut it,
// and the hash never reaches a server.
import { extract } from "./extract.js";

const target = new URL("add.html", location.href);
target.search = location.search; // keeps ?emulator in tests
// Target "_blank" so every click opens a fresh window: a fixed name would let a hostile shop page
// pre-open a window of that name and receive add.html in it. noopener keeps the shop page from
// reaching the popup through window.opener.
// popup=1 tells add.html it was opened by the bookmarklet, so it may close itself after saving.
const code = `(()=>{try{const d=(${extract})(document);` +
  `const u=new URL(${JSON.stringify(target.href)});u.searchParams.set("popup","1");` +
  `window.open(u.href+"#"+encodeURIComponent(JSON.stringify(d)),"_blank","width=640,height=820,noopener")}` +
  `catch(e){alert("chce: nie udało się odczytać strony")}})()`;
document.getElementById("bookmarklet").href = "javascript:" + encodeURIComponent(code);

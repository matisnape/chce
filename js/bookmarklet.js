// Builds the bookmarklet from js/extract.js, so the code on the shop page is the tested code.
// Page data travels in the popup URL's hash: no postMessage, so a shop's opener policy cannot cut it,
// and the hash never reaches a server.
import { extract } from "./extract.js";

const target = new URL("add.html", location.href);
target.search = location.search; // keeps ?emulator in tests
const code = `(()=>{const d=(${extract})(document);` +
  `window.open(${JSON.stringify(target.href)}+"#"+encodeURIComponent(JSON.stringify(d)),"chce","width=640,height=820")})()`;
document.getElementById("bookmarklet").href = "javascript:" + encodeURIComponent(code);

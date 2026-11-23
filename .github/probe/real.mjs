// Runs the published shortcut script's encoding on extract() of a real shop page.
import { parseHTML } from "linkedom";
import { writeFileSync } from "node:fs";
import { extract } from "../../js/extract.js";
const url = process.argv[2];
const html = await (await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" } })).text();
const { document } = parseHTML(html);
const proto = Object.getPrototypeOf(document.createElement("img"));
proto.getBoundingClientRect = () => ({ width: 0, height: 0 });
Object.defineProperty(document, "images", { value: [...document.querySelectorAll("img")] });
Object.defineProperty(document, "baseURI", { value: url });
Object.defineProperty(document, "location", { value: { href: url } });
const d = extract(document);
console.log(JSON.stringify(d, null, 1));
const live = "https://anks.pl/chce/add.html#" + encodeURIComponent(JSON.stringify(d)).replace(/\./g, "%2E");
const strict = "https://anks.pl/chce/add.html#" + encodeURIComponent(JSON.stringify(d)).replace(/[.!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
writeFileSync("hashes.txt", [live, strict].join("\n") + "\n");

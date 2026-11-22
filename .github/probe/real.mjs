// Runs extract() on the real shop page and prints the old and new hash text, one per line.
import { parseHTML } from "linkedom";
import { writeFileSync } from "node:fs";
import { extract } from "../../js/extract.js";
const url = "https://www.weareknitters.pl/products/osiris-snood-kit-yummy-version?_pos=23&_sid=acc3cd55b&_ss=r";
const html = await (await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" } })).text();
const { document } = parseHTML(html);
const proto = Object.getPrototypeOf(document.createElement("img"));
proto.getBoundingClientRect = () => ({ width: 0, height: 0 });
Object.defineProperty(document, "images", { value: [...document.querySelectorAll("img")] });
Object.defineProperty(document, "baseURI", { value: url });
Object.defineProperty(document, "location", { value: { href: url } });
const d = extract(document);
console.error(JSON.stringify(d, null, 1));
const json = JSON.stringify(d);
const add = "https://anks.pl/chce/add.html#";
const pct = encodeURIComponent(json), dots = pct.replace(/\./g, "%2E"), b = Buffer.from(json).toString("base64url");
writeFileSync("hashes.txt", [add + pct, add + dots, dots, add + b, add + "b64_" + b, add + dots + dots.slice(0, 1200)].join("\n") + "\n");

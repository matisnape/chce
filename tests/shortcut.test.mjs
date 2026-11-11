// js/shortcut.js is generated from js/extract.js: it fails when the two drift apart.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildScript } from "../scripts/build-shortcut.mjs";

assert.equal(
  readFileSync(new URL("../js/shortcut.js", import.meta.url), "utf8"),
  buildScript(),
  "js/shortcut.js is stale: run `node scripts/build-shortcut.mjs`",
);
console.log("shortcut.js matches extract.js");

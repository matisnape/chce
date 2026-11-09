// Run: node tests/util.test.mjs
import assert from "node:assert/strict";
import { parsePrice, safeUrl } from "../js/util.js";

assert.equal(parsePrice("1 299,99 zł"), 1299.99);
assert.equal(parsePrice("1,299.99"), 1299.99);
assert.equal(parsePrice("12,5"), 12.5);
assert.equal(parsePrice("49"), 49);
assert.equal(parsePrice(""), null);
assert.equal(parsePrice("brak"), null);

assert.equal(safeUrl("https://shop.pl/a?b=1"), "https://shop.pl/a?b=1");
assert.equal(safeUrl("javascript:alert(1)"), null);
assert.equal(safeUrl("data:text/html,x"), null);
assert.equal(safeUrl(""), null);
console.log("util ok");

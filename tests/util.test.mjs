// Run: node tests/util.test.mjs
import assert from "node:assert/strict";
import { parsePrice, safeUrl, pluralItems } from "../js/util.js";

assert.equal(parsePrice("1 299,99 zł"), 1299.99);
assert.equal(parsePrice("1,299.99"), 1299.99);
assert.equal(parsePrice("12,5"), 12.5);
assert.equal(parsePrice("49"), 49);
assert.equal(parsePrice("1.299,00"), 1299);
assert.equal(parsePrice("1.299,5"), 1299.5);
assert.equal(parsePrice("1.299"), 1299);
assert.equal(parsePrice("1,299"), 1299);
assert.equal(parsePrice("1.299.000"), 1299000);
assert.equal(parsePrice("12.5"), 12.5);
assert.equal(parsePrice(""), null);
assert.equal(parsePrice("brak"), null);

assert.equal(safeUrl("https://shop.pl/a?b=1"), "https://shop.pl/a?b=1");
assert.equal(safeUrl("javascript:alert(1)"), null);
assert.equal(safeUrl("data:text/html,x"), null);
assert.equal(safeUrl(""), null);
console.log("util ok");

assert.deepEqual([0, 1, 2, 4, 5, 12, 14, 21, 22, 25, 112].map(pluralItems),
  ["0 pozycji", "1 pozycja", "2 pozycje", "4 pozycje", "5 pozycji", "12 pozycji", "14 pozycji", "21 pozycji", "22 pozycje", "25 pozycji", "112 pozycji"]);

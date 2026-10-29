import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePageExpr, checkPageSyntax, tokenize } from "../../pages.mjs";

const pick = (expr, total) => parsePageExpr(expr, total).map((i) => i + 1);

test("single pages, lists and ranges, in the order written", () => {
  assert.deepEqual(pick("3", 5), [3]);
  assert.deepEqual(pick("3,1,2", 5), [3, 1, 2]);
  assert.deepEqual(pick("2-4", 5), [2, 3, 4]);
  assert.deepEqual(pick("1-2, 5", 5), [1, 2, 5]);
  assert.deepEqual(pick("  ALL ", 3), [1, 2, 3]);
});

test("descending ranges reverse, and a page may repeat", () => {
  assert.deepEqual(pick("4-2", 5), [4, 3, 2]);
  assert.deepEqual(pick("5-1", 5), [5, 4, 3, 2, 1]);
  assert.deepEqual(pick("1,1,2,1", 3), [1, 1, 2, 1]);
});

test("end and rN count from the back", () => {
  assert.deepEqual(pick("end", 4), [4]);
  assert.deepEqual(pick("r1", 4), [4]);
  assert.deepEqual(pick("r2", 4), [3]);
  assert.deepEqual(pick("r1,1-r2", 4), [4, 1, 2, 3]);
  assert.deepEqual(pick("3-end", 6), [3, 4, 5, 6]);
  assert.deepEqual(pick("end-1", 3), [3, 2, 1]);
});

test("odd and even keep alternate pages", () => {
  assert.deepEqual(pick("odd", 5), [1, 3, 5]);
  assert.deepEqual(pick("even", 5), [2, 4]);
  assert.throws(() => parsePageExpr("even", 1), { code: "INPUT_INVALID", message: /selects nothing/ });
});

test("! removes pages from what was selected so far; a leading ! starts from every page", () => {
  assert.deepEqual(pick("all,!2", 4), [1, 3, 4]);
  assert.deepEqual(pick("!2", 4), [1, 3, 4]);
  assert.deepEqual(pick("!1-2", 4), [3, 4]);
  assert.deepEqual(pick("1-5,!odd", 5), [2, 4]);
  assert.deepEqual(pick("3,1,!3,2", 3), [1, 2]);
  assert.deepEqual(pick("all,!end,end", 3), [1, 2, 3]);
  assert.throws(() => parsePageExpr("1-2,!1-2", 5), { code: "INPUT_INVALID", message: /selects nothing/ });
});

test("pages that do not exist are named in the error with the real page count", () => {
  assert.throws(() => parsePageExpr("9", 4), { code: "INPUT_INVALID", message: /Page "9" in "9" does not exist: the document has 4 pages/ });
  assert.throws(() => parsePageExpr("1-9", 4), { message: /"9" in "1-9"/ });
  assert.throws(() => parsePageExpr("r5", 4), { message: /does not exist/ });
  assert.throws(() => parsePageExpr("1", 1).length && parsePageExpr("2", 1), { message: /1 page\b/ });
  assert.throws(() => parsePageExpr("0", 4), { message: /does not exist/ });
});

test("bad syntax is explained and rejected without needing a page count", () => {
  for (const bad of ["", "   ", "a", "1-2-3", "1,,2", "x1", "1..3", "-3", "3-", "!!2", "r", "r0x", "1;2", "1 2", "9999999"]) {
    assert.throws(() => checkPageSyntax(bad), { code: "INPUT_INVALID" }, JSON.stringify(bad));
  }
  assert.doesNotThrow(() => checkPageSyntax("999999")); // syntax is fine; whether the page exists is checked against the document
  assert.throws(() => checkPageSyntax("1-2-3"), { message: /is not a page number or range/ });
  assert.throws(() => checkPageSyntax(""), { message: /must not be empty/ });
  assert.equal(tokenize("1, !2").length, 2);
});

test("limits keep absurd expressions cheap", () => {
  assert.throws(() => checkPageSyntax(Array.from({ length: 201 }, (_, i) => i + 1).join(",")), { message: /more than 200 parts/ });
  assert.throws(() => parsePageExpr(Array.from({ length: 150 }, () => "1-100").join(","), 100), { message: /more than 5000 pages/ });
  assert.equal(parsePageExpr("1-100", 100).length, 100);
});

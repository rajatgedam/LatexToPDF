import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, normalizeInput, escapeText } from "../../src/input.mjs";

const OPTS = { maxBytes: 1000 };

test("classify detects full documents, fragments and plain text", () => {
  assert.equal(classify("\\documentclass{article}\\begin{document}x\\end{document}"), "latex");
  assert.equal(classify("\\section{Hi} text"), "fragment");
  assert.equal(classify("just words, 100% plain"), "text");
});

test("a commented-out documentclass does not count", () => {
  assert.equal(classify("% \\documentclass{article}\nhello"), "text");
});

test("full documents pass through unchanged (BOM stripped, CRLF normalized)", () => {
  const src = "\ufeff\\documentclass{article}\r\n\\begin{document}x\\end{document}";
  const { tex, kind } = normalizeInput(src, OPTS);
  assert.equal(kind, "latex");
  assert.equal(tex, "\\documentclass{article}\n\\begin{document}x\\end{document}");
});

test("fragments are wrapped in a document", () => {
  const { tex, kind } = normalizeInput("\\section{Hi}", OPTS);
  assert.equal(kind, "fragment");
  assert.match(tex, /^\\documentclass/);
  assert.match(tex, /\\begin\{document\}\n\\section\{Hi\}\n\\end\{document\}/);
});

test("plain text is escaped so it cannot inject commands", () => {
  const { tex, kind } = normalizeInput("cost: $5 & 10% #1 a_b {x}", OPTS);
  assert.equal(kind, "text");
  assert.match(tex, /cost: \\\$5 \\& 10\\% \\#1 a\\_b \\\{x\\\}/);
});

test("escapeText covers every TeX special character", () => {
  assert.equal(escapeText("\\ { } $ & # ^ _ % ~"), "\\textbackslash{} \\{ \\} \\$ \\& \\# \\textasciicircum{} \\_ \\% \\textasciitilde{}");
});

test("explicit mode overrides detection", () => {
  assert.equal(normalizeInput("\\section{x}", { ...OPTS, mode: "text" }).kind, "text");
  assert.throws(() => normalizeInput("hello", { ...OPTS, mode: "latex" }), { code: "INPUT_INVALID" });
  assert.throws(() => normalizeInput("hello", { ...OPTS, mode: "nope" }), { code: "INPUT_INVALID" });
});

test("empty, non-string, NUL and oversized inputs are rejected", () => {
  assert.throws(() => normalizeInput("  \n ", OPTS), { code: "INPUT_EMPTY" });
  assert.throws(() => normalizeInput(undefined, OPTS), { code: "INPUT_INVALID" });
  assert.throws(() => normalizeInput(42, OPTS), { code: "INPUT_INVALID" });
  assert.throws(() => normalizeInput("a\0b", OPTS), { code: "INPUT_INVALID" });
  assert.throws(() => normalizeInput("x".repeat(1001), OPTS), { code: "INPUT_TOO_LARGE" });
});

test("size limit counts bytes, not characters", () => {
  assert.throws(() => normalizeInput("é".repeat(600), OPTS), { code: "INPUT_TOO_LARGE" });
});

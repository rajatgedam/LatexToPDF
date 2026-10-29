import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCompat } from "../../compat.mjs";

test("removes pdfTeX-only directives that break XeTeX", () => {
  const src = "\\input{glyphtounicode}\n\\pdfgentounicode=1\n\\pdfoutput=1\n\\pdfminorversion = 7\n\\pdfcompresslevel=9\nkeep me";
  const { tex, notes } = applyCompat(src);
  assert.equal(tex, "\n\n\n\n\nkeep me");
  assert.ok(notes.length >= 4);
  assert.ok(notes.every((n) => n.startsWith("compat:")));
});

test("leaves unrelated source untouched and reports no notes", () => {
  const src = "\\documentclass{article}\n\\usepackage{hyperref}\n\\pdfstringdef\\x{y}";
  assert.deepEqual(applyCompat(src), { tex: src, notes: [] });
});

test("does not touch commented-out lines' meaning or similarly named macros", () => {
  const src = "% \\pdfgentounicode=1\n\\pdfgentounicodeextra";
  assert.equal(applyCompat(src).tex, src);
});

test("handles directives preceded by spaces and trailing comments", () => {
  assert.equal(applyCompat("  \\pdfgentounicode=1 % unicode").tex, "");
});

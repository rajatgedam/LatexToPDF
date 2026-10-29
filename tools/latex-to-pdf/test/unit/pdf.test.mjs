import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { countPages } from "../../pdf.mjs";

const objStm = (inner) => {
  const data = deflateSync(inner);
  return Buffer.concat([
    Buffer.from(`%PDF-1.5\n3 0 obj\n<< /Type /ObjStm /N 3 /First 10 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`),
    data,
    Buffer.from("\nendstream\nendobj\n"),
  ]);
};

test("counts pages stored in compressed object streams", () => {
  assert.equal(countPages(objStm("<< /Type /Page /Parent 1 0 R >> << /Type /Page >> << /Type /Pages /Count 2 >>")), 2);
});

test("counts plain page objects and ignores /Pages and /PageLabels", () => {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Pages/Count 1>>endobj\n2 0 obj<</Type/Page>>endobj\n3 0 obj<</Type/PageLabels>>endobj");
  assert.equal(countPages(pdf), 1);
});

test("returns 0 for garbage and survives corrupt streams", () => {
  assert.equal(countPages(Buffer.from("not a pdf")), 0);
  const bad = Buffer.from("%PDF-1.5\n<< /Type /ObjStm /Length 4 >>\nstream\nxxxx\nendstream");
  assert.equal(countPages(bad), 0);
});

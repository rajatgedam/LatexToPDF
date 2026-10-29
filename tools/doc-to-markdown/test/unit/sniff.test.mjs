import { test } from "node:test";
import assert from "node:assert/strict";
import { sniff, tidyMarkdown, TYPES, PANDOC_READER } from "../../sniff.mjs";

const zip = (...names) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), ...names.map((n) => Buffer.from(`\0\0${n}\0\0`))]);
const text = (s) => Buffer.from(s, "utf8");

test("PDFs are recognised even with junk before the header", () => {
  assert.equal(sniff(Buffer.from("%PDF-1.7\n...")), "pdf");
  assert.equal(sniff(Buffer.concat([Buffer.from("\r\n junk "), Buffer.from("%PDF-1.4")])), "pdf");
});

test("Office, ODF and EPUB zips are told apart by what they contain", () => {
  assert.equal(sniff(zip("[Content_Types].xml", "word/document.xml")), "docx");
  assert.equal(sniff(zip("ppt/presentation.xml")), "pptx");
  assert.equal(sniff(zip("xl/workbook.xml")), "xlsx");
  assert.equal(sniff(zip("mimetypeapplication/epub+zip")), "epub");
  assert.equal(sniff(zip("mimetypeapplication/vnd.oasis.opendocument.text")), "odt");
  assert.equal(sniff(zip("random.txt")), null);
});

test("text formats are recognised from their content", () => {
  assert.equal(sniff(text("<!DOCTYPE html><html><body>x</body></html>")), "html");
  assert.equal(sniff(text("  <html lang='en'>")), "html");
  assert.equal(sniff(text("{\\rtf1\\ansi hello}")), "rtf");
  assert.equal(sniff(text('{"cells": [], "nbformat": 4}')), "ipynb");
  assert.equal(sniff(text("\\documentclass{article}\n\\begin{document}x\\end{document}")), "latex");
  assert.equal(sniff(text("name,score\nann,3\nbob,5\n")), "csv");
  assert.equal(sniff(text("name\tscore\nann\t3\nbob\t5\n")), "tsv");
  assert.equal(sniff(text("# Just markdown\n\nwith words, and commas\n")), "text");
  assert.equal(sniff(text("a,b\nc\n")), "text", "uneven comma counts are not a table");
});

test("binary junk that is not a document is rejected", () => {
  assert.equal(sniff(Buffer.from([0xff, 0xfe, 0x00, 0x81, 0x82])), null);
  assert.equal(sniff(Buffer.alloc(100, 0xc3)), null);
});

test("text cut in the middle of a multi-byte character at the sniff boundary is still text", () => {
  const body = Buffer.concat([Buffer.alloc(8191, 0x61), Buffer.from("é plus more words")]);
  assert.equal(sniff(body), "text");
});

test("every pandoc-backed kind has a reader, and pdf/text never go to pandoc", () => {
  for (const t of TYPES) assert.equal(t in PANDOC_READER, !["pdf", "text"].includes(t), t);
});

test("tidyMarkdown makes output compact and readable for a model", () => {
  const md = tidyMarkdown('Title  \r\n\r\n\r\n\r\n![A chart](media/image1.png){width="3in"} and ![](x.png)\n<span class="smallcaps">Name</span>\n   \nend   ');
  assert.equal(md, "Title\n\n[image: A chart] and [image]\nName\n\nend\n");
  assert.equal(tidyMarkdown("  \n\n"), "\n");
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { createToolMaster } from "../../../../core/index.mjs";
import { resolveEngine } from "../../../../core/engines.mjs";
import { runProcess } from "../../../../core/process.mjs";
import tool from "../../tool.mjs";

let root;
let tm;
const read = (input, options) => tm.runner.run("doc-to-markdown", { input, options });

/** A real PDF with the given text lines on each page (Helvetica, one line per entry). */
async function makePdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([400, 400]);
    lines.forEach((text, i) => text && page.drawText(text, { x: 30, y: 360 - i * 20, size: 12, font }));
  }
  return Buffer.from(await doc.save());
}

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tm-d2m-pdf-"));
  tm = await createToolMaster({ env: { TOOLMASTER_SANDBOX: "off" }, projectRoot: root, tools: [tool] });
});
after(() => rm(root, { recursive: true, force: true }));

test("a PDF becomes Markdown with one marker per page, lines kept in order", async () => {
  const pdf = await makePdf([["Alex Sample", "Software Engineer at Example Corp"], ["Education", "B.S. in Computer Science"]]);
  const r = await read(pdf, {});
  assert.equal(r.data.toString(), "<!-- page 1 -->\n\nAlex Sample\nSoftware Engineer at Example Corp\n\n<!-- page 2 -->\n\nEducation\nB.S. in Computer Science\n");
  assert.deepEqual([r.meta.kind, r.meta.pages], ["pdf", 2]);
  assert.deepEqual(r.warnings, []);
});

test("page markers can be turned off", async () => {
  const r = await read(await makePdf([["one"], ["two"]]), { markers: false });
  assert.equal(r.data.toString(), "one\n\ntwo\n");
});

test("pages without text are reported, and an all-image PDF says it needs OCR", async () => {
  const mixed = await read(await makePdf([["words"], []]), {});
  assert.deepEqual(mixed.warnings, ["1 page(s) had no text (scanned or image-only)"]);
  const blank = await read(await makePdf([[], []]), {});
  assert.match(blank.warnings[0], /scanned PDF. OCR is not included/);
});

test("damaged PDFs are INPUT_INVALID, not crashes", async () => {
  await assert.rejects(read(Buffer.from("%PDF-1.7\nnot really a pdf"), {}), { code: "INPUT_INVALID", message: /Could not read this PDF/ });
});

test("very large page counts are refused with a pointer to the pdf-pages tool", async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 1001; i++) doc.addPage([50, 50]);
  await assert.rejects(read(Buffer.from(await doc.save()), {}), { code: "INPUT_INVALID", message: /limit is 1000.*pdf-pages/ });
});

test("the PDF reader runs in its own process, not inside the host", async () => {
  const r = await read(await makePdf([["isolated"]]), { markers: false });
  assert.equal(r.data.toString(), "isolated\n");
  assert.equal(globalThis.pdfjsWorker, undefined, "pdf.js was never loaded into this process");
});

// Real Pandoc: build office files with Pandoc itself, then read them back through the tool.
const havePandoc = await (async () => {
  const probe = await createToolMaster({ env: { TOOLMASTER_SANDBOX: "off" }, tools: [tool] });
  return resolveEngine(probe.config, probe.engines.get("pandoc")).then(() => probe, () => null);
})();
const pandocOpts = { skip: havePandoc ? false : "pandoc not installed (run: toolmaster install)" };

async function makeWith(format, markdown) {
  const command = await resolveEngine(havePandoc.config, havePandoc.engines.get("pandoc"));
  const { outputs } = await runProcess({
    command, config: havePandoc.config, files: { "in.md": markdown }, outputs: [`out.${format}`], args: ["-f", "markdown", "-t", format, "-o", `out.${format}`, "in.md"],
  });
  return outputs[`out.${format}`];
}

test("DOCX, PPTX, EPUB and ODT are read through Pandoc", pandocOpts, async () => {
  const md = "# Quarterly Plan\n\nRevenue grows **fast**.\n\n- alpha item\n- beta item\n\n## Second Slide\n\nclosing words\n";
  const rt = await createToolMaster({ env: { TOOLMASTER_SANDBOX: "off" }, tools: [tool] });
  for (const [format, kind] of [["docx", "docx"], ["pptx", "pptx"], ["epub", "epub"], ["odt", "odt"]]) {
    const r = await rt.runner.run("doc-to-markdown", { input: await makeWith(format, md), options: {} });
    assert.equal(r.meta.kind, kind, format);
    assert.match(r.data.toString(), /Quarterly Plan/, format);
    assert.match(r.data.toString(), /alpha item/, format);
  }
});

test("HTML and CSV are read through Pandoc; RTF and LaTeX sources work too", pandocOpts, async () => {
  const rt = await createToolMaster({ env: { TOOLMASTER_SANDBOX: "off" }, tools: [tool] });
  const html = await rt.runner.run("doc-to-markdown", { input: Buffer.from("<html><body><h1>Hi</h1><p>some <b>bold</b> text</p></body></html>"), options: {} });
  assert.match(html.data.toString(), /# Hi/);
  const csv = await rt.runner.run("doc-to-markdown", { input: Buffer.from("name,score\nann,3\nbob,5\n"), options: {} });
  assert.match(csv.data.toString(), /\| name \| score \|/);
  const tex = await rt.runner.run("doc-to-markdown", { input: Buffer.from("\\documentclass{article}\\begin{document}\\section{Intro}Hello \\textbf{there}.\\end{document}"), options: {} });
  assert.match(tex.data.toString(), /# Intro/);
  assert.match(tex.data.toString(), /\*\*there\*\*/);
});

test("images in office files become [image] markers instead of dangling links", pandocOpts, async () => {
  const r = await (await createToolMaster({ env: { TOOLMASTER_SANDBOX: "off" }, tools: [tool] })).runner.run("doc-to-markdown", {
    input: Buffer.from('<html><body><p>before <img src="https://example.test/x.png" alt="A chart"> after</p></body></html>'), options: {},
  });
  assert.match(r.data.toString(), /\[image: A chart\]/);
  assert.doesNotMatch(r.data.toString(), /example\.test/);
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import { createToolMaster } from "../../../../core/index.mjs";
import tool from "../../tool.mjs";

let root;
let tm;
let four;

/** A PDF whose page n is (100 + n) points wide, so order can be read back from the sizes. */
async function makePdf(count, { title } = {}) {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= count; i++) doc.addPage([100 + i, 200]);
  if (title) doc.setTitle(title);
  return Buffer.from(await doc.save());
}
const widths = async (buf) => (await PDFDocument.load(buf)).getPages().map((p) => p.getWidth() - 100);
const rotations = async (buf) => (await PDFDocument.load(buf)).getPages().map((p) => p.getRotation().angle);
const run = (input, options) => tm.runner.run("pdf-pages", { input, options });

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tm-pdfpages-"));
  tm = await createToolMaster({ env: { TOOLMASTER_SANDBOX: "off" }, projectRoot: root, tools: [tool] });
  four = await makePdf(4, { title: "Four pages" });
});
after(() => rm(root, { recursive: true, force: true }));

test("manifest: a binary PDF in, a PDF out, with page and rotation options and no engine", () => {
  const m = tool.manifest;
  assert.equal(m.id, "pdf-pages");
  assert.deepEqual([m.input.kind, m.input.accept, m.output.extension, m.preview], ["binary", [".pdf"], "pdf", "file"]);
  assert.deepEqual(m.options.map((o) => [o.id, o.type]), [["pages", "string"], ["rotate", "enum"]]);
  assert.equal(m.engines, undefined);
  assert.match(m.useWhen, /PyPDF/);
});

test("pages are picked and reordered in the order given", async () => {
  const r = await run(four, { pages: "r1,1-r2" });
  assert.deepEqual(await widths(r.data), [4, 1, 2, 3]);
  assert.deepEqual(r.meta, { sourcePages: 4, pages: 4 });
  assert.equal(r.contentType, "application/pdf");
  assert.deepEqual(await widths((await run(four, { pages: "3,1,1" })).data), [3, 1, 1]);
  assert.deepEqual(await widths((await run(four, { pages: "even" })).data), [2, 4]);
});

test("a range is extracted, a page is deleted, the default keeps everything", async () => {
  assert.deepEqual(await widths((await run(four, { pages: "2-3" })).data), [2, 3]);
  assert.deepEqual(await widths((await run(four, { pages: "all,!2" })).data), [1, 3, 4]);
  assert.deepEqual(await widths((await run(four, {})).data), [1, 2, 3, 4]);
});

test("rotation is added to each kept page's own rotation and wraps at 360", async () => {
  assert.deepEqual(await rotations((await run(four, { pages: "1-2", rotate: "90" })).data), [90, 90]);
  const rotated = (await run(four, { rotate: "270" })).data;
  assert.deepEqual(await rotations((await run(rotated, { rotate: "180" })).data), [90, 90, 90, 90]);
  assert.deepEqual(await rotations((await run(four, { rotate: "0" })).data), [0, 0, 0, 0]);
});

test("the title survives and the producer says ToolMaster", async () => {
  const out = await PDFDocument.load((await run(four, { pages: "1" })).data, { updateMetadata: false });
  assert.equal(out.getTitle(), "Four pages");
  assert.equal(out.getProducer(), "ToolMaster");
});

test("bad requests are INPUT_INVALID with a message a person (or an agent) can act on", async () => {
  await assert.rejects(run(four, { pages: "9" }), { code: "INPUT_INVALID", message: /does not exist: the document has 4 pages/ });
  await assert.rejects(run(four, { pages: "1-2-3" }), { code: "INPUT_INVALID", message: /not a page number or range/ });
  await assert.rejects(run(four, { pages: "all,!1-4" }), { code: "INPUT_INVALID", message: /selects nothing/ });
  await assert.rejects(run(four, { rotate: "45" }), { code: "INPUT_INVALID" });
  await assert.rejects(run(Buffer.from("just some text, not a pdf"), {}), { code: "INPUT_INVALID", message: /does not look like a PDF/ });
  await assert.rejects(run(Buffer.from("%PDF-1.7\nthis is not a real pdf body at all"), {}), { code: "INPUT_INVALID", message: /Could not read this PDF/ });
});

test("the work happens in a separate process whose crash cannot take the host down", async () => {
  // a self that always dies stands in for a parser killed by the OS (out of memory, timeout)
  const dying = await createToolMaster({ env: { TOOLMASTER_SANDBOX: "off" }, projectRoot: root, tools: [tool], self: { command: process.execPath, args: ["-e", "process.exit(9)"], ro: [] } });
  await assert.rejects(dying.runner.run("pdf-pages", { input: four, options: {} }), { code: "TOOL_FAILED", message: /PDF Pages failed/ });
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createToolMaster } from "../../../../core/index.mjs";
import tool from "../../tool.mjs";
import { layoutText } from "../../worker.mjs";
import { makeFakePandoc } from "../../../../test/helpers/fake-pandoc.mjs";

let fake;
let root;
const tmFor = (env = {}) => createToolMaster({ env: { TOOLMASTER_SANDBOX: "off", TOOLMASTER_ENGINE_PANDOC: fake.path, ...env }, projectRoot: root, tools: [tool] });
const read = async (input, options, env) => (await tmFor(env)).runner.run("doc-to-markdown", { input: Buffer.from(input), options });
const zip = (...names) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), ...names.map((n) => Buffer.from(`\0\0${n}\0\0`))]);
const argsOf = (r) => JSON.parse(r.data.toString().replace(/^<pre>/, "").replace(/<\/pre>\s*$/, ""));

before(async () => {
  fake = await makeFakePandoc();
  root = await mkdtemp(path.join(os.tmpdir(), "tm-d2m-"));
});
after(async () => {
  await fake.cleanup();
  await rm(root, { recursive: true, force: true });
});

test("manifest: any document in, Markdown out, text preview, pandoc as the only engine", () => {
  const m = tool.manifest;
  assert.equal(m.id, "doc-to-markdown");
  assert.deepEqual([m.input.kind, m.output.extension, m.preview, m.engines], ["binary", "md", "text", ["pandoc"]]);
  assert.ok(m.input.accept.includes(".pdf") && m.input.accept.includes(".docx") && m.input.accept.includes(".xlsx"));
  assert.deepEqual(m.options.map((o) => o.id), ["type", "markers"]);
  assert.match(m.useWhen, /Do not write a pdftotext/);
});

test("pandoc-backed kinds run pandoc sandboxed, with the reader chosen from the bytes", async () => {
  const csv = await read("a,b\n1,%%ARGS\n", {});
  const { args } = argsOf(csv);
  assert.deepEqual(args.slice(0, 3), ["--sandbox", "-f", "csv"]);
  assert.deepEqual(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2), ["-t", "gfm"]);
  assert.ok(args.includes("--wrap=none"));
  assert.equal(csv.meta.kind, "csv");
  assert.equal(csv.extension, "md");
  const docx = await tmFor().then((tm) => tm.runner.run("doc-to-markdown", { input: Buffer.concat([zip("word/document.xml"), Buffer.from("%%ARGS")]), options: {} }));
  assert.equal(docx.meta.kind, "docx");
});

test("the type option overrides sniffing", async () => {
  const r = await read("just words %%ARGS", { type: "html" });
  assert.equal(r.meta.kind, "html");
  assert.ok(argsOf(r).args.includes("html"));
});

test("plain text passes through without starting any program", async () => {
  const r = await read("# Title\n\nbody   \n\n\n\ntail", {}, { TOOLMASTER_ENGINE_PANDOC: "/definitely/not/there" });
  assert.equal(r.data.toString(), "# Title\n\nbody\n\ntail\n");
  assert.deepEqual([r.meta.kind, r.meta.chars], ["text", 20]);
  await assert.rejects(tmFor().then((tm) => tm.runner.run("doc-to-markdown", { input: Buffer.from([0xc3, 0x28, 0x41]), options: { type: "text" } })), { code: "INPUT_INVALID", message: /not valid UTF-8/ });
});

test("unknown binary files get an actionable error", async () => {
  await assert.rejects(tmFor().then((tm) => tm.runner.run("doc-to-markdown", { input: Buffer.from([0xff, 0xfe, 0x81, 0x82]), options: {} })), { code: "INPUT_INVALID", message: /Unsupported file: expected a PDF, DOCX/ });
  await assert.rejects(read("x", { type: "mp3" }), { code: "INPUT_INVALID" });
});

test("pandoc failures and warnings are surfaced", async () => {
  await assert.rejects(read("a,b\n1,%%FAIL", {}), { code: "TOOL_FAILED", message: /Pandoc failed: Error at/ });
  const r = await read("a,b\n1,%%WARN", {});
  assert.deepEqual(r.warnings, ["[WARNING] Could not convert something"]);
});

test("layoutText rebuilds lines from positioned text and inserts paragraph gaps", () => {
  const it = (str, x, y, width = str.length * 5, height = 10) => ({ str, transform: [10, 0, 0, height, x, y], width, height });
  const text = layoutText([
    it("Hello", 0, 700), it("world", 30, 700), // same line, gap > 15% of height -> a space
    it("again", 0, 686),
    it("next", 0, 650), // gap larger than 1.8 lines -> blank line
    it("same", 30, 650.5), // within half a line height -> same line
    it("  ", 0, 640), // whitespace-only line is dropped
    { str: 5 }, { hasEOL: true }, // not text items
  ]);
  assert.equal(text, "Hello world\nagain\n\nnext same");
});

test("layoutText does not add a space between touching fragments", () => {
  const it = (str, x) => ({ str, transform: [10, 0, 0, 10, x, 100], width: str.length * 5, height: 10 });
  assert.equal(layoutText([it("Hel", 0), it("lo", 15)]), "Hello");
  assert.equal(layoutText([it("a ", 0), it("b", 10.5)]), "a b");
  assert.equal(layoutText([]), "");
});

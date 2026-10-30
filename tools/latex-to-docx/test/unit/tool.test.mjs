import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createToolMaster } from "../../../../core/index.mjs";
import tool from "../../tool.mjs";
import { makeFakePandoc } from "../../../../test/helpers/fake-pandoc.mjs";

let fake;
let root;
const tmFor = (env = {}) => createToolMaster({ env: { TOOLMASTER_SANDBOX: "off", TOOLMASTER_ENGINE_PANDOC: fake.path, ...env }, projectRoot: root, tools: [tool] });
const convert = async (input, options, env) => (await tmFor(env)).runner.run("latex-to-docx", { input, options });
const preview = async (input, options) => (await tmFor()).runner.preview("latex-to-docx", { input, options });
const argsOf = (result) => JSON.parse(result.data.toString().slice(2));

before(async () => {
  fake = await makeFakePandoc();
  root = await mkdtemp(path.join(os.tmpdir(), "tm-docx-"));
});
after(async () => {
  await fake.cleanup();
  await rm(root, { recursive: true, force: true });
});

test("manifest: text in, DOCX out, HTML preview, two options, pandoc engine", () => {
  const m = tool.manifest;
  assert.equal(m.id, "latex-to-docx");
  assert.equal(m.output.extension, "docx");
  assert.match(m.output.contentType, /wordprocessingml\.document$/);
  assert.equal(m.preview, "html");
  assert.deepEqual(m.options.map((o) => o.id), ["mode", "toc"]);
  assert.deepEqual(m.engines, ["pandoc"]);
  assert.ok(m.sample.includes("\\begin{document}"));
});

test("converts LaTeX to a DOCX (zip) file and reports the detected kind", async () => {
  const r = await convert("\\section{Hello}", {});
  assert.equal(r.data.subarray(0, 2).toString(), "PK");
  assert.equal(r.extension, "docx");
  assert.equal(r.meta.kind, "latex");
});

test("pandoc always runs with --sandbox and writes to a file in the work dir", async () => {
  const { args, input } = argsOf(await convert("\\section{Hello} %%ARGS", {}));
  assert.equal(args[0], "--sandbox");
  assert.deepEqual(args.slice(args.indexOf("-f"), args.indexOf("-f") + 2), ["-f", "latex"]);
  assert.ok(args.includes("--wrap=none"));
  assert.deepEqual(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2), ["-t", "docx"]);
  assert.equal(args[args.indexOf("-o") + 1], "out.docx");
  assert.ok(!args.includes("--toc"));
  assert.match(input, /section\{Hello\}/);
});

test("auto mode: LaTeX commands -> latex, otherwise plain text as markdown without raw html/tex", async () => {
  const text = argsOf(await convert("plain words with 100% and _stuff_ %%ARGS", {}));
  assert.equal(text.args[text.args.indexOf("-f") + 1], "markdown-raw_html-raw_tex");
  assert.equal((await convert("plain words", {})).meta.kind, "text");
  assert.equal((await convert("\\textbf{x}", { mode: "text" })).meta.kind, "text");
  assert.equal((await convert("no commands here", { mode: "latex" })).meta.kind, "latex");
  assert.equal((await convert("% \\hidden comment only", {})).meta.kind, "text");
});

test("the toc option adds --toc for DOCX output only", async () => {
  assert.ok(argsOf(await convert("\\section{A} %%ARGS", { toc: true })).args.includes("--toc"));
  const p = await preview("\\section{A} %%ARGS", { toc: true });
  assert.ok(!p.data.toString().includes("--toc"));
});

test("BOM and CRLF are normalized before conversion", async () => {
  const { input } = argsOf(await convert("\ufeff\\a\r\n%%ARGS\r\n", {}));
  assert.equal(input, "\\a\n%%ARGS\n");
});

test("pandoc warnings are surfaced", async () => {
  assert.deepEqual((await convert("\\a %%WARN", {})).warnings, ["[WARNING] Could not convert something"]);
});

test("failures carry a readable error line and log; bad output is rejected", async () => {
  await assert.rejects(convert("\\a %%FAIL", {}), (e) => e.code === "TOOL_FAILED" && /^Pandoc failed: Error at/.test(e.message) && /unexpected input/.test(e.log));
  await assert.rejects(convert("\\a %%NOOUT", {}), { code: "TOOL_FAILED" });
  await assert.rejects(convert("\\a %%BADDOCX", {}), { code: "TOOL_FAILED", message: /valid DOCX/ });
});

test("preview returns a self-contained, locked-down HTML page", async () => {
  const p = await preview("\\section{A}", {});
  const html = p.data.toString();
  assert.match(p.contentType, /^text\/html/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:">/);
  assert.match(html, /<body bgcolor="#ffffff"[^>]*><p>fake<\/p><\/body>/);
  const withMath = argsOf({ data: Buffer.from("xx" + (await preview("\\a %%ARGS", {})).data.toString().replace(/^.*<pre>/s, "").replace(/<\/pre>.*$/s, "")) });
  assert.ok(withMath.args.includes("--mathml"));
  assert.equal(withMath.args[withMath.args.indexOf("-t") + 1], "html5");
  assert.ok(withMath.args.includes("-s"));
  assert.equal(withMath.args[withMath.args.indexOf("-o") + 1], "out.html");
});

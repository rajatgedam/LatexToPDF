import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createToolMaster } from "../../../../core/index.mjs";
import tool from "../../tool.mjs";
import { SAMPLE } from "../../sample.mjs";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const tm = await createToolMaster({ env: { ...process.env, TOOLMASTER_TIMEOUT_MS: "60000" }, tools: [tool] });
const ready = (await tm.runner.status({ fresh: true }))["latex-to-docx"].ready;
const opts = { skip: ready ? false : "pandoc not installed (node bin/toolmaster.mjs install latex-to-docx)" };
const convert = (input, options) => tm.runner.run("latex-to-docx", { input, options });
const preview = async (input, options) => (await tm.runner.preview("latex-to-docx", { input, options })).data.toString();

let dir;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tm-int-docx-"));
});
after(() => rm(dir, { recursive: true, force: true }));

test("converts the sample to a real DOCX package", opts, async () => {
  const r = await convert(SAMPLE);
  assert.equal(r.data.subarray(0, 2).toString(), "PK");
  const names = r.data.toString("latin1");
  for (const part of ["word/document.xml", "word/styles.xml", "[Content_Types].xml"]) assert.ok(names.includes(part), part);
  assert.equal(r.meta.kind, "latex");
  assert.ok(r.durationMs < 10_000);
});

test("the HTML preview shows the structure: headings, list, table, math", opts, async () => {
  const html = await preview(SAMPLE);
  assert.match(html, /Quarterly Report/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /<h1[^>]*>Highlights<\/h1>/);
  assert.match(html, /<li>/);
  assert.match(html, /<table/);
  assert.match(html, /<math/);
});

test("a table of contents can be requested", opts, async () => {
  const plain = await convert(SAMPLE);
  const withToc = await convert(SAMPLE, { toc: true });
  assert.notDeepEqual(plain.data, withToc.data);
});

test("plain text is not interpreted as raw HTML", opts, async () => {
  const html = await preview("hello <script>alert(1)</script> world", { mode: "text" });
  assert.ok(!/<script/i.test(html.replace(/<meta[^>]*>/g, "")), html);
});

test("pandoc --sandbox keeps documents from reading files on disk", opts, async () => {
  const secret = path.join(dir, "secret.tex");
  await writeFile(secret, "TOPSECRETMARKER");
  const attempts = [`\\input{${secret}}`, `\\include{${secret}}`, `\\verbatiminput{${secret}}`, `\\lstinputlisting{${secret}}`];
  for (const body of attempts) {
    const src = `\\documentclass{article}\\begin{document}${body}\\end{document}`;
    const html = await preview(src).catch(() => "");
    assert.ok(!html.includes("TOPSECRETMARKER"), body);
    const docx = await convert(src).then((r) => r.data.toString("latin1"), () => "");
    assert.ok(!docx.includes("TOPSECRETMARKER"), body);
  }
});

test("invalid LaTeX is reported with pandoc's own message, not crashed on", opts, async () => {
  await assert.rejects(convert("\\begin{itemize} \\item unbalanced"), (e) => e.code === "TOOL_FAILED" && /unexpected end of input/.test(e.log));
  await assert.rejects(convert("x", { mode: "bogus" }), { code: "INPUT_INVALID" });
});

test("CLI end to end: file in, DOCX out; the toc option via -O", opts, async () => {
  const input = path.join(dir, "in.tex");
  const output = path.join(dir, "cli.docx");
  await writeFile(input, SAMPLE);
  const { stdout } = await run(process.execPath, [path.join(root, "bin/toolmaster.mjs"), "latex-to-docx", "-i", input, "-o", output, "-O", "toc=true", "--json"]);
  assert.equal(JSON.parse(stdout).ok, true);
  assert.equal((await readFile(output)).subarray(0, 2).toString(), "PK");
});

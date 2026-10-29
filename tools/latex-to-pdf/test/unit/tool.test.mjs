import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createToolMaster } from "../../../../core/index.mjs";
import tool from "../../tool.mjs";
import { SAMPLE } from "../../sample.mjs";
import { makeFakeEngine, TEX } from "../../../../test/helpers/fake-engine.mjs";

let fake;
let root;
const tmFor = (env = {}) =>
  createToolMaster({ env: { TOOLMASTER_SANDBOX: "off", TOOLMASTER_ENGINE_TECTONIC: fake.path, ...env }, projectRoot: root, tools: [tool] });
const compile = async (input, env, options) => (await tmFor(env)).runner.run("latex-to-pdf", { input, options });

before(async () => {
  fake = await makeFakeEngine();
  root = await mkdtemp(path.join(os.tmpdir(), "tm-l2p-"));
});
after(async () => {
  await fake.cleanup();
  await rm(root, { recursive: true, force: true });
});

test("manifest describes a text-in, PDF-out tool with a PDF preview", () => {
  const m = tool.manifest;
  assert.equal(m.id, "latex-to-pdf");
  assert.equal(m.input.kind, "text");
  assert.equal(m.output.extension, "pdf");
  assert.equal(m.preview, "file");
  assert.deepEqual(m.engines.map((e) => e.id), ["tectonic"]);
  assert.ok(m.sample.includes("\\documentclass"));
  assert.equal(m.sample, SAMPLE);
});

test("compiles a document and reports kind, pages and engine warnings", async () => {
  const r = await compile(TEX("%%WARN"));
  assert.equal(r.data.subarray(0, 5).toString(), "%PDF-");
  assert.equal(r.contentType, "application/pdf");
  assert.equal(r.meta.kind, "latex");
  assert.deepEqual(r.warnings, ["warning: Overfull hbox"]);
});

test("fragments and plain text are wrapped; the mode option forces the interpretation", async () => {
  assert.equal((await compile("\\section{Hi} text")).meta.kind, "fragment");
  assert.equal((await compile("just words")).meta.kind, "text");
  assert.equal((await compile("\\section{Hi}", {}, { mode: "text" })).meta.kind, "text");
  await assert.rejects(compile("hello", {}, { mode: "latex" }), { code: "INPUT_INVALID" });
  await assert.rejects(compile("hello", {}, { mode: "weird" }), { code: "INPUT_INVALID" });
});

test("pdfTeX-only directives are stripped and reported", async () => {
  const r = await compile(`\\pdfgentounicode=1\n${TEX("x")}`);
  assert.ok(r.warnings.some((w) => w.startsWith("compat:")));
});

test("policy violations are rejected before the engine runs", async () => {
  await assert.rejects(compile(TEX("\\immediate\\write18{id}")), { code: "POLICY_VIOLATION" });
});

test("engine runs untrusted, never with shell-escape, and honors offline mode", async () => {
  const args = async (env) => JSON.parse((await compile(TEX("%%ARGS"), env)).data.toString().slice(9)).args;
  const normal = await args({});
  assert.ok(normal.includes("--untrusted"));
  assert.ok(!normal.join(" ").includes("shell-escape"));
  assert.ok(!normal.includes("--only-cached"));
  assert.ok((await args({ TOOLMASTER_OFFLINE: "1" })).includes("--only-cached"));
});

test("only the package cache is passed to the engine, under the tool's own cache dir", async () => {
  const env = JSON.parse((await compile(TEX("%%ENV"))).data.toString().slice(9));
  assert.equal(env.TECTONIC_CACHE_DIR, path.join(root, "vendor", "cache", "tectonic"));
});

test("LaTeX errors surface as TOOL_FAILED with a sanitized log", async () => {
  await assert.rejects(compile(TEX("%%FAIL")), (e) => e.code === "TOOL_FAILED" && /Undefined control sequence/.test(e.log) && !/tm-work-/.test(e.log));
});

test("an engine that writes a non-PDF is reported as a failure", async () => {
  await assert.rejects(compile(TEX("%%BADPDF")), { code: "TOOL_FAILED", message: /valid PDF/ });
});

test("warmup compiles the sample and a package-heavy document", async () => {
  const tm = await tmFor();
  assert.equal(await tm.runner.warmup("latex-to-pdf"), true);
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, readdir, symlink, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config.mjs";
import { createCompiler } from "../../src/compile.mjs";
import { makeFakeEngine, TEX } from "../helpers/fake-engine.mjs";

let fake;
let dir;
const make = (env = {}) =>
  createCompiler(loadConfig({ LATEX2PDF_ENGINE: fake.path, TECTONIC_CACHE_DIR: path.join(dir, "cache"), LATEX2PDF_MAX_INPUT_BYTES: "5000", ...env }));

before(async () => {
  fake = await makeFakeEngine();
  dir = await mkdtemp(path.join(os.tmpdir(), "l2p-ct-"));
});
after(async () => {
  await fake.cleanup();
  await rm(dir, { recursive: true, force: true });
});

test("compile returns pdf, kind, duration and warnings", async () => {
  const r = await make().compile({ source: TEX("%%WARN") });
  assert.equal(r.pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(r.kind, "latex");
  assert.ok(r.durationMs >= 0);
  assert.deepEqual(r.warnings, ["warning: Overfull hbox"]);
});

test("policy violations are rejected before the engine runs", async () => {
  await assert.rejects(make().compile({ source: TEX("\\immediate\\write18{id}") }), { code: "POLICY_VIOLATION" });
});

test("input validation errors propagate", async () => {
  await assert.rejects(make().compile({ source: "" }), { code: "INPUT_EMPTY" });
  await assert.rejects(make().compile({ source: "x".repeat(6000) }), { code: "INPUT_TOO_LARGE" });
});

test("excess concurrency is rejected with BUSY and the slot is released afterwards", async () => {
  const c = make({ LATEX2PDF_MAX_CONCURRENCY: "1" });
  const slow = c.compile({ source: TEX("%%SLEEP"), timeoutMs: 400 });
  await new Promise((r) => setTimeout(r, 100));
  await assert.rejects(c.compile({ source: TEX() }), { code: "BUSY" });
  await assert.rejects(slow, { code: "TIMEOUT" });
  assert.equal((await c.compile({ source: TEX() })).pdf.length > 0, true);
});

test("compileToFile reads an input file and writes the PDF atomically", async () => {
  const input = path.join(dir, "in.tex");
  const output = path.join(dir, "out1.pdf");
  await writeFile(input, TEX());
  const r = await make().compileToFile({ input, output });
  assert.equal(r.outputPath, output);
  assert.equal(r.bytes, (await readFile(output)).length);
  assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith(".tmp")), []);
});

test("compileToFile accepts inline source and overwrites existing output", async () => {
  const output = path.join(dir, "out2.pdf");
  await writeFile(output, "old");
  await make().compileToFile({ source: TEX(), output });
  assert.match((await readFile(output, "latin1")), /^%PDF-/);
});

test("compileToFile can create missing parent directories on request", async () => {
  const output = path.join(dir, "a", "b", "out.pdf");
  await assert.rejects(make().compileToFile({ source: TEX(), output }), { code: "OUTPUT_PATH_INVALID" });
  await make().compileToFile({ source: TEX(), output, mkdir: true });
  assert.ok((await readFile(output)).length > 0);
});

test("output path rules", async () => {
  const c = make();
  await assert.rejects(c.compileToFile({ source: TEX(), output: path.join(dir, "x.txt") }), { code: "OUTPUT_PATH_INVALID" });
  await assert.rejects(c.compileToFile({ source: TEX(), output: "" }), { code: "OUTPUT_PATH_INVALID" });
  await mkdir(path.join(dir, "isdir.pdf"));
  await assert.rejects(c.compileToFile({ source: TEX(), output: path.join(dir, "isdir.pdf") }), { code: "OUTPUT_PATH_INVALID" });
  await writeFile(path.join(dir, "target"), "t");
  await symlink(path.join(dir, "target"), path.join(dir, "link.pdf"));
  await assert.rejects(c.compileToFile({ source: TEX(), output: path.join(dir, "link.pdf") }), { code: "OUTPUT_PATH_INVALID" });
  assert.equal(await readFile(path.join(dir, "target"), "utf8"), "t");
});

test("input rules for compileToFile", async () => {
  const c = make();
  const output = path.join(dir, "o.pdf");
  await assert.rejects(c.compileToFile({ output }), { code: "INPUT_INVALID" });
  await assert.rejects(c.compileToFile({ input: "a", source: "b", output }), { code: "INPUT_INVALID" });
  await assert.rejects(c.compileToFile({ input: path.join(dir, "missing.tex"), output }), { code: "INPUT_INVALID" });
  await assert.rejects(c.compileToFile({ input: dir, output }), { code: "INPUT_INVALID" });
  const big = path.join(dir, "big.tex");
  await writeFile(big, "x".repeat(6000));
  await assert.rejects(c.compileToFile({ input: big, output }), { code: "INPUT_TOO_LARGE" });
  const bad = path.join(dir, "bad.tex");
  await writeFile(bad, Buffer.from([0xff, 0xfe, 0xfa]));
  await assert.rejects(c.compileToFile({ input: bad, output }), { code: "INPUT_INVALID" });
});

test("no output file is created when compilation fails", async () => {
  const output = path.join(dir, "never.pdf");
  await assert.rejects(make().compileToFile({ source: TEX("%%FAIL"), output }), { code: "COMPILE_FAILED" });
  await assert.rejects(readFile(output), { code: "ENOENT" });
});

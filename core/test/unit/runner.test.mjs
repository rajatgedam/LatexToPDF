import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, readdir, symlink, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../config.mjs";
import { createRegistry } from "../../registry.mjs";
import { createRunner, resolveOptions } from "../../runner.mjs";
import { ToolMasterError } from "../../sdk.mjs";
import { fakeTool, fakeEngineSpec } from "../../../test/helpers/fake-tool.mjs";

let dir;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tm-run-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const runnerFor = (tools, env = {}) => {
  const config = loadConfig({ TOOLMASTER_MAX_INPUT_BYTES: "1000", TOOLMASTER_SANDBOX: "off", ...env }, { projectRoot: dir });
  return createRunner({ config, registry: createRegistry(tools) });
};
const upper = () => fakeTool();

test("run returns data, content type, extension, meta and duration", async () => {
  const r = await runnerFor([upper()]).run("fake-tool", { input: "hello" });
  assert.equal(r.data.toString(), "HELLO");
  assert.equal(r.contentType, "text/plain");
  assert.equal(r.extension, "out");
  assert.deepEqual(r.meta, { chars: 5 });
  assert.deepEqual(r.warnings, []);
  assert.ok(r.durationMs >= 0);
});

test("unknown tools are TOOL_NOT_FOUND", async () => {
  await assert.rejects(runnerFor([upper()]).run("ghost", { input: "x" }), { code: "TOOL_NOT_FOUND" });
});

test("text input is validated by the core, not by each tool", async () => {
  const r = runnerFor([upper()]);
  await assert.rejects(r.run("fake-tool", { input: "" }), { code: "INPUT_EMPTY" });
  await assert.rejects(r.run("fake-tool", { input: "  \n" }), { code: "INPUT_EMPTY" });
  await assert.rejects(r.run("fake-tool", { input: 5 }), { code: "INPUT_INVALID" });
  await assert.rejects(r.run("fake-tool", { input: "a\0b" }), { code: "INPUT_INVALID" });
  await assert.rejects(r.run("fake-tool", { input: "x".repeat(1001) }), { code: "INPUT_TOO_LARGE" });
  await assert.rejects(r.run("fake-tool", { input: "é".repeat(600) }), { code: "INPUT_TOO_LARGE" });
});

test("a manifest can raise the input limit (binary tools)", async () => {
  const bin = fakeTool({ manifest: { id: "bin-tool", input: { kind: "binary", accept: [".bin"], maxBytes: 5000 } }, run: async (_c, { input }) => ({ data: input }) });
  const r = runnerFor([bin]);
  assert.equal((await r.run("bin-tool", { input: Buffer.alloc(4000, 1) })).data.length, 4000);
  await assert.rejects(r.run("bin-tool", { input: Buffer.alloc(5001) }), { code: "INPUT_TOO_LARGE" });
  await assert.rejects(r.run("bin-tool", { input: Buffer.alloc(0) }), { code: "INPUT_EMPTY" });
  await assert.rejects(r.run("bin-tool", { input: "text" }), { code: "INPUT_INVALID" });
});

test("options are validated, coerced and defaulted", () => {
  const manifest = {
    options: [
      { id: "mode", label: "Mode", type: "enum", values: ["a", "b"], default: "a" },
      { id: "toc", label: "TOC", type: "boolean", default: false },
    ],
  };
  assert.deepEqual(resolveOptions(manifest, {}), { mode: "a", toc: false });
  assert.deepEqual(resolveOptions(manifest, { mode: "b", toc: "true" }), { mode: "b", toc: true });
  assert.deepEqual(resolveOptions(manifest, { toc: "0" }), { mode: "a", toc: false });
  for (const bad of [{ mode: "z" }, { toc: "maybe" }, { nope: 1 }, []]) assert.throws(() => resolveOptions(manifest, bad), { code: "INPUT_INVALID" });
  assert.throws(() => resolveOptions(manifest, null), { code: "INPUT_INVALID" });
  assert.deepEqual(resolveOptions({}, {}), {});
});

test("tools receive resolved options and a context with limits, exec and cacheDir", async () => {
  let seen;
  const t = fakeTool({
    manifest: { options: [{ id: "mode", label: "Mode", type: "enum", values: ["a", "b"], default: "a" }], engines: [fakeEngineSpec()] },
    run: async (ctx, req) => ((seen = { ctx, req }), { data: Buffer.from("x") }),
  });
  await runnerFor([t]).run("fake-tool", { input: "hi", options: { mode: "b" }, timeoutMs: 1234 });
  assert.deepEqual(seen.req, { input: "hi", options: { mode: "b" } });
  assert.equal(seen.ctx.timeoutMs, 1234);
  assert.equal(seen.ctx.limits.maxInputBytes, 1000);
  assert.equal(await seen.ctx.cacheDir("x"), path.join(dir, "vendor", "cache", "x"));
  assert.equal(typeof seen.ctx.exec, "function");
  await assert.rejects(seen.ctx.engine("not-declared"), { code: "TOOL_INVALID" });
  await assert.rejects(seen.ctx.engine("fake-engine"), { code: "ENGINE_NOT_FOUND" });
});

test("tool failures keep their code; bad results are rejected", async () => {
  const failing = fakeTool({ run: async () => { throw new ToolMasterError("TOOL_FAILED", "nope", { log: "the log" }); } });
  await assert.rejects(runnerFor([failing]).run("fake-tool", { input: "x" }), { code: "TOOL_FAILED", log: "the log" });
  const empty = fakeTool({ run: async () => ({}) });
  await assert.rejects(runnerFor([empty]).run("fake-tool", { input: "x" }), { code: "TOOL_FAILED" });
  const big = fakeTool({ run: async () => ({ data: Buffer.alloc(2000) }) });
  await assert.rejects(runnerFor([big], { TOOLMASTER_MAX_OUTPUT_BYTES: "1000" }).run("fake-tool", { input: "x" }), { code: "OUTPUT_TOO_LARGE" });
});

test("excess concurrency is rejected with BUSY and the slot is released afterwards", async () => {
  const slow = fakeTool({ run: (ctx) => new Promise((resolve, reject) => { ctx.signal.addEventListener("abort", () => reject(new ToolMasterError("TIMEOUT", "cancelled"))); }) });
  const r = runnerFor([slow], { TOOLMASTER_MAX_CONCURRENCY: "1" });
  const ac = new AbortController();
  const first = r.run("fake-tool", { input: "a", signal: ac.signal });
  await new Promise((res) => setTimeout(res, 50));
  await assert.rejects(r.run("fake-tool", { input: "b" }), { code: "BUSY" });
  ac.abort();
  await assert.rejects(first, { code: "TIMEOUT" });
  const quick = runnerFor([upper()], { TOOLMASTER_MAX_CONCURRENCY: "1" });
  assert.ok((await quick.run("fake-tool", { input: "x" })).data.length > 0);
});

test("preview needs manifest.preview=html and goes through the same checks", async () => {
  const withPreview = fakeTool({ manifest: { preview: "html" }, preview: async (_c, { input }) => ({ data: Buffer.from(`<p>${input}</p>`), contentType: "text/html; charset=utf-8" }) });
  const r = runnerFor([withPreview]);
  const p = await r.preview("fake-tool", { input: "hi" });
  assert.equal(p.data.toString(), "<p>hi</p>");
  assert.match(p.contentType, /text\/html/);
  await assert.rejects(runnerFor([upper()]).preview("fake-tool", { input: "hi" }), { code: "INPUT_INVALID" });
  await assert.rejects(r.preview("fake-tool", { input: "" }), { code: "INPUT_EMPTY" });
});

test("runToFile reads an input file and writes atomically", async () => {
  const input = path.join(dir, "in.txt");
  const output = path.join(dir, "out1.out");
  await writeFile(input, "hello");
  const r = await runnerFor([upper()]).runToFile({ tool: "fake-tool", input, output });
  assert.equal(r.outputPath, output);
  assert.equal(await readFile(output, "utf8"), "HELLO");
  assert.equal(r.bytes, 5);
  assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith(".tmp")), []);
});

test("runToFile accepts inline source, overwrites, and can create parent dirs", async () => {
  const output = path.join(dir, "deep", "er", "o.out");
  const r = runnerFor([upper()]);
  await assert.rejects(r.runToFile({ tool: "fake-tool", source: "x", output }), { code: "OUTPUT_PATH_INVALID" });
  await r.runToFile({ tool: "fake-tool", source: "x", output, mkdir: true });
  await r.runToFile({ tool: "fake-tool", source: "y", output });
  assert.equal(await readFile(output, "utf8"), "Y");
});

test("output path rules", async () => {
  const r = runnerFor([upper()]);
  const go = (output) => r.runToFile({ tool: "fake-tool", source: "x", output });
  await assert.rejects(go(path.join(dir, "x.pdf")), { code: "OUTPUT_PATH_INVALID" });
  await assert.rejects(go(""), { code: "OUTPUT_PATH_INVALID" });
  await mkdir(path.join(dir, "isdir.out"));
  await assert.rejects(go(path.join(dir, "isdir.out")), { code: "OUTPUT_PATH_INVALID" });
  await writeFile(path.join(dir, "target"), "t");
  await symlink(path.join(dir, "target"), path.join(dir, "link.out"));
  await assert.rejects(go(path.join(dir, "link.out")), { code: "OUTPUT_PATH_INVALID" });
  assert.equal(await readFile(path.join(dir, "target"), "utf8"), "t");
});

test("input rules for runToFile", async () => {
  const r = runnerFor([upper()]);
  const output = path.join(dir, "o2.out");
  await assert.rejects(r.runToFile({ tool: "fake-tool", output }), { code: "INPUT_INVALID" });
  await assert.rejects(r.runToFile({ tool: "fake-tool", input: "a", source: "b", output }), { code: "INPUT_INVALID" });
  await assert.rejects(r.runToFile({ tool: "fake-tool", input: path.join(dir, "missing.txt"), output }), { code: "INPUT_INVALID" });
  await assert.rejects(r.runToFile({ tool: "fake-tool", input: dir, output }), { code: "INPUT_INVALID" });
  const big = path.join(dir, "big.txt");
  await writeFile(big, "x".repeat(1001));
  await assert.rejects(r.runToFile({ tool: "fake-tool", input: big, output }), { code: "INPUT_TOO_LARGE" });
  const bad = path.join(dir, "bad.txt");
  await writeFile(bad, Buffer.from([0xff, 0xfe, 0xfa]));
  await assert.rejects(r.runToFile({ tool: "fake-tool", input: bad, output }), { code: "INPUT_INVALID" });
  await assert.rejects(readFile(output), { code: "ENOENT" });
});

test("runToFile reads binary inputs as bytes", async () => {
  const bin = fakeTool({ manifest: { id: "bin-tool", input: { kind: "binary", accept: [".bin"] } }, run: async (_c, { input }) => ({ data: input }) });
  const input = path.join(dir, "in.bin");
  const output = path.join(dir, "o3.out");
  await writeFile(input, Buffer.from([0xff, 0x00, 0x7f]));
  await runnerFor([bin]).runToFile({ tool: "bin-tool", input, output });
  assert.deepEqual([...(await readFile(output))], [0xff, 0x00, 0x7f]);
});

test("status reports engine availability per tool and hides paths", async () => {
  const needsEngine = fakeTool({ manifest: { id: "needs-engine", engines: [fakeEngineSpec({ id: "nowhere", binary: "definitely-not-installed-xyz" })] } });
  const r = runnerFor([upper(), needsEngine]);
  const s = await r.status({ fresh: true });
  assert.deepEqual(s["fake-tool"], { ready: true, engines: [] });
  assert.deepEqual(s["needs-engine"], { ready: false, engines: [{ id: "nowhere", found: false }] });
  assert.deepEqual(await r.status(), s);
});

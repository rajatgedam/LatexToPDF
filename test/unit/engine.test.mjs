import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config.mjs";
import { runEngine, resolveEngine } from "../../src/engine.mjs";
import { makeFakeEngine, TEX } from "../helpers/fake-engine.mjs";

let fake;
let tmpRoot;
const cfg = (extra = {}, env = {}) =>
  loadConfig({ LATEX2PDF_ENGINE: fake.path, LATEX2PDF_SANDBOX: "off", TECTONIC_CACHE_DIR: os.tmpdir() + "/l2p-test-cache", ...env }, extra);
const run = (marker, env, opts = {}) => runEngine({ tex: TEX(marker), config: cfg({}, env), timeoutMs: 5000, tmpRoot, ...opts });
const leftovers = () => readdir(tmpRoot);

before(async () => {
  fake = await makeFakeEngine();
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "l2p-root-"));
});
after(async () => {
  await fake.cleanup();
  await rm(tmpRoot, { recursive: true, force: true });
});

test("returns the PDF produced by the engine", async () => {
  const { pdf } = await run("");
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
});

test("passes untrusted flag, never shell-escape, and runs inside a temp dir", async () => {
  const { pdf } = await run("%%ARGS");
  const { args, cwd } = JSON.parse(pdf.toString().slice(9));
  assert.ok(args.includes("--untrusted"));
  assert.ok(!args.join(" ").includes("shell-escape"));
  assert.ok(!args.includes("--only-cached"));
  assert.match(cwd, /l2p-work-/);
});

test("offline mode adds --only-cached", async () => {
  const { pdf } = await run("%%ARGS", { LATEX2PDF_OFFLINE: "1" });
  assert.ok(JSON.parse(pdf.toString().slice(9)).args.includes("--only-cached"));
});

test("scrubs secrets from the child environment", async () => {
  process.env.SUPER_SECRET_TOKEN = "hunter2";
  try {
    const { pdf } = await run("%%ENV");
    const env = JSON.parse(pdf.toString().slice(9));
    assert.equal(env.SUPER_SECRET_TOKEN, undefined);
    assert.ok(env.TECTONIC_CACHE_DIR);
  } finally {
    delete process.env.SUPER_SECRET_TOKEN;
  }
});

test("compile failure returns sanitized log without the temp path", async () => {
  await assert.rejects(run("%%FAIL"), (e) => {
    assert.equal(e.code, "COMPILE_FAILED");
    assert.match(e.log, /Undefined control sequence/);
    assert.doesNotMatch(e.log, /l2p-work-/);
    assert.match(e.log, /<work>/);
    return true;
  });
});

test("missing or non-PDF output is a compile failure", async () => {
  await assert.rejects(run("%%NOPDF"), { code: "COMPILE_FAILED" });
  await assert.rejects(run("%%BADPDF"), { code: "COMPILE_FAILED" });
});

test("timeout kills the engine and reports TIMEOUT", async () => {
  const t0 = Date.now();
  await assert.rejects(run("%%SLEEP", {}, { timeoutMs: 300 }), { code: "TIMEOUT" });
  assert.ok(Date.now() - t0 < 4000);
});

test("abort signal cancels the run", async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 100);
  await assert.rejects(run("%%SLEEP", {}, { signal: ac.signal }), { code: "TIMEOUT" });
});

test("oversized PDF is rejected", async () => {
  await assert.rejects(run("%%BIG", { LATEX2PDF_MAX_OUTPUT_BYTES: "1000" }), { code: "OUTPUT_TOO_LARGE" });
});

test("engine log capture is capped", async () => {
  const { log } = await run("%%FLOOD");
  assert.ok(log.length <= 300_000);
});

test("temp directories are always removed", async () => {
  await run("");
  await assert.rejects(run("%%FAIL"));
  await assert.rejects(run("%%SLEEP", {}, { timeoutMs: 200 }));
  assert.deepEqual(await leftovers(), []);
});

test("resolveEngine fails clearly when nothing is available", async () => {
  await assert.rejects(resolveEngine(loadConfig({ LATEX2PDF_ENGINE: "/nonexistent/tectonic" })), { code: "ENGINE_NOT_FOUND" });
});

test("resolveEngine honors an explicit path", async () => {
  assert.equal(await resolveEngine(cfg()), fake.path);
});

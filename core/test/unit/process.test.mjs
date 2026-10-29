import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../config.mjs";
import { runProcess } from "../../process.mjs";
import { makeFakeEngine, TEX } from "../../../test/helpers/fake-engine.mjs";

let fake;
let tmpRoot;
const config = (env = {}) => loadConfig({ TOOLMASTER_SANDBOX: "off", ...env });
const run = (marker, { env, procEnv, ...extra } = {}) =>
  runProcess({
    command: fake.path,
    args: (dir) => ["--outdir", dir, "main.tex"],
    files: { "main.tex": TEX(marker) },
    outputs: ["main.pdf"],
    env: procEnv,
    config: config(env),
    timeoutMs: 5000,
    tmpRoot,
    ...extra,
  });

before(async () => {
  fake = await makeFakeEngine();
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "tm-root-"));
});
after(async () => {
  await fake.cleanup();
  await rm(tmpRoot, { recursive: true, force: true });
});

test("returns the requested output files", async () => {
  const { outputs, code } = await run("");
  assert.equal(code, 0);
  assert.equal(outputs["main.pdf"].subarray(0, 5).toString(), "%PDF-");
});

test("runs inside a private temp dir with the given args", async () => {
  const { outputs } = await run("%%ARGS");
  const { args, cwd } = JSON.parse(outputs["main.pdf"].toString().slice(9));
  assert.ok(args.includes("--outdir"));
  assert.match(cwd, /tm-work-/);
});

test("scrubs secrets from the child environment but passes explicit variables", async () => {
  process.env.SUPER_SECRET_TOKEN = "hunter2";
  try {
    const { outputs } = await run("%%ENV", { procEnv: { MY_TOOL_VAR: "ok" } });
    const env = JSON.parse(outputs["main.pdf"].toString().slice(9));
    assert.equal(env.SUPER_SECRET_TOKEN, undefined);
    assert.equal(env.MY_TOOL_VAR, "ok");
    assert.match(env.TMPDIR, /tm-work-/);
  } finally {
    delete process.env.SUPER_SECRET_TOKEN;
  }
});

test("failure returns TOOL_FAILED with a sanitized, readable log", async () => {
  await assert.rejects(run("%%FAIL", { label: "Fake" }), (e) => {
    assert.equal(e.code, "TOOL_FAILED");
    assert.match(e.message, /^Fake failed: ! Undefined control sequence/);
    assert.match(e.log, /<work>/);
    assert.doesNotMatch(e.log, /tm-work-/);
    return true;
  });
});

test("a missing output file is a failure; a non-zero exit is a failure even with no outputs requested", async () => {
  await assert.rejects(run("%%NOPDF"), { code: "TOOL_FAILED" });
  await assert.rejects(run("%%FAIL", { outputs: [] }), { code: "TOOL_FAILED" });
});

test("timeout kills the process and reports TIMEOUT", async () => {
  const t0 = Date.now();
  await assert.rejects(run("%%SLEEP", { timeoutMs: 300 }), { code: "TIMEOUT" });
  assert.ok(Date.now() - t0 < 4000);
});

test("abort signal cancels the run", async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 100);
  await assert.rejects(run("%%SLEEP", { signal: ac.signal }), { code: "TIMEOUT", message: "Cancelled" });
});

test("oversized output is rejected", async () => {
  await assert.rejects(run("%%BIG", { maxOutputBytes: 1000 }), { code: "OUTPUT_TOO_LARGE" });
});

test("captured log is capped", async () => {
  const { log } = await run("%%FLOOD");
  assert.ok(log.length <= 300_000);
});

test("temp directories are always removed", async () => {
  await run("");
  await assert.rejects(run("%%FAIL"));
  await assert.rejects(run("%%SLEEP", { timeoutMs: 200 }));
  assert.deepEqual(await readdir(tmpRoot), []);
});

test("unsafe file names are refused before anything runs", async () => {
  await assert.rejects(run("", { files: { "../evil.tex": "x" } }), { code: "INPUT_INVALID" });
  await assert.rejects(run("", { outputs: ["a/b.pdf"] }), { code: "INPUT_INVALID" });
  assert.deepEqual(await readdir(tmpRoot), []);
});

test("read-write directories are created on demand", async () => {
  const dir = path.join(tmpRoot, "cache", "x");
  await run("", { rw: [dir] });
  assert.ok((await stat(dir)).isDirectory());
});

test("a command that cannot start is reported as ENGINE_NOT_FOUND", async () => {
  await assert.rejects(run("", { command: "/nonexistent/engine" }), { code: "ENGINE_NOT_FOUND" });
});

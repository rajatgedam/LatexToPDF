import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { runCli, exitCodeFor } from "../../src/cli.mjs";
import { makeFakeEngine, TEX } from "../helpers/fake-engine.mjs";

let fake;
let dir;
const env = () => ({ LATEX2PDF_ENGINE: fake.path, TECTONIC_CACHE_DIR: path.join(dir, "cache") });

async function cli(args, { stdin = "" } = {}) {
  let out = "";
  let err = "";
  const code = await runCli(args, {
    env: env(),
    stdin: Readable.from([stdin]),
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
  });
  return { code, out, err };
}

before(async () => {
  fake = await makeFakeEngine();
  dir = await mkdtemp(path.join(os.tmpdir(), "l2p-cli-"));
});
after(async () => {
  await fake.cleanup();
  await rm(dir, { recursive: true, force: true });
});

test("compiles a file and prints a human summary", async () => {
  const input = path.join(dir, "a.tex");
  const output = path.join(dir, "a.pdf");
  await writeFile(input, TEX());
  const r = await cli(["-i", input, "-o", output]);
  assert.equal(r.code, 0);
  assert.match(r.out, /a\.pdf/);
  assert.match(await readFile(output, "latin1"), /^%PDF-/);
});

test("--json prints exactly one JSON object", async () => {
  const output = path.join(dir, "b.pdf");
  const r = await cli(["-i", "-", "-o", output, "--json"], { stdin: TEX() });
  assert.equal(r.code, 0);
  const j = JSON.parse(r.out);
  assert.equal(j.ok, true);
  assert.equal(j.outputPath, output);
  assert.ok(j.bytes > 0);
});

test("usage errors exit 2 and print usage", async () => {
  assert.equal((await cli([])).code, 2);
  assert.equal((await cli(["-i", "x.tex"])).code, 2);
  assert.equal((await cli(["--bogus"])).code, 2);
  assert.equal((await cli(["-i", "x", "-o", "y.pdf", "-m", "weird"])).code, 2);
  assert.equal((await cli(["-i", "x", "-o", "y.pdf", "--timeout", "abc"])).code, 2);
});

test("--help exits 0 and documents exit codes", async () => {
  const r = await cli(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /Exit codes/);
});

test("policy violation exits 3, compile failure exits 4 with log on stderr", async () => {
  const output = path.join(dir, "c.pdf");
  assert.equal((await cli(["-i", "-", "-o", output], { stdin: TEX("\\write18{id}") })).code, 3);
  const r = await cli(["-i", "-", "-o", output], { stdin: TEX("%%FAIL") });
  assert.equal(r.code, 4);
  assert.match(r.err, /Undefined control sequence/);
});

test("--json errors carry code and message on stdout", async () => {
  const r = await cli(["-i", "-", "-o", path.join(dir, "d.pdf"), "--json"], { stdin: TEX("%%FAIL") });
  const j = JSON.parse(r.out);
  assert.equal(j.ok, false);
  assert.equal(j.error.code, "COMPILE_FAILED");
});

test("timeout exits 5", async () => {
  const r = await cli(["-i", "-", "-o", path.join(dir, "e.pdf"), "--timeout", "300"], { stdin: TEX("%%SLEEP") });
  assert.equal(r.code, 5);
});

test("missing engine exits 6", async () => {
  const code = await runCli(["-i", "-", "-o", path.join(dir, "f.pdf")], {
    env: { LATEX2PDF_ENGINE: "/nonexistent/tectonic" },
    stdin: Readable.from([TEX()]),
    stdout: { write() {} },
    stderr: { write() {} },
  });
  assert.equal(code, 6);
});

test("--check reports engine status", async () => {
  const r = await cli(["--check", "--json"]);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).engine.found, true);
});

test("exitCodeFor maps every documented error code", () => {
  const map = { INPUT_EMPTY: 2, INPUT_TOO_LARGE: 2, INPUT_INVALID: 2, OUTPUT_PATH_INVALID: 2, CONFIG_INVALID: 2, POLICY_VIOLATION: 3, COMPILE_FAILED: 4, OUTPUT_TOO_LARGE: 4, TIMEOUT: 5, ENGINE_NOT_FOUND: 6, BUSY: 7 };
  for (const [code, exit] of Object.entries(map)) assert.equal(exitCodeFor(code), exit, code);
  assert.equal(exitCodeFor("???"), 1);
});

test("oversized stdin is rejected without buffering everything", async () => {
  const r = await cli(["-i", "-", "-o", path.join(dir, "g.pdf")], { stdin: "x".repeat(2_000_000) });
  assert.equal(r.code, 2);
});

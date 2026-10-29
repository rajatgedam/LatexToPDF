import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config.mjs";
import { engineInfo, runEngine } from "../../src/engine.mjs";
import { SANDBOX_EXEC } from "../../src/sandbox.mjs";
import { countPages } from "../../src/pdf.mjs";

const base = { LATEX2PDF_TIMEOUT_MS: "120000" };
const hasSandbox = await access(SANDBOX_EXEC).then(() => true, () => false);
const hasEngine = (await engineInfo(loadConfig(base))).found;
const opts = { skip: !hasEngine ? "no engine" : !hasSandbox ? "no OS sandbox on this platform" : false };

let dir;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "l2p-sbx-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const doc = (body) => `\\documentclass{article}\\begin{document}${body}\\end{document}`;
const on = loadConfig({ ...base, LATEX2PDF_SANDBOX: "on" });

test("sandboxed compile of a normal document still works", opts, async () => {
  const { pdf } = await runEngine({ tex: doc("hello sandbox"), config: on });
  assert.equal(countPages(pdf), 1);
});

test("sandbox blocks reading files outside the work dir even if the policy scan is bypassed", opts, async () => {
  const secret = path.join(dir, "secret.tex");
  await writeFile(secret, "\\def\\x{TOPSECRET}");
  const tex = doc(`\\input{${secret}}\\x`);
  await assert.rejects(runEngine({ tex, config: on }), (e) => e.code === "COMPILE_FAILED");
});

test("sandbox blocks reading the user's home directory", opts, async () => {
  const tex = doc(`\\input{${path.join(os.homedir(), ".zshrc")}}`);
  await assert.rejects(runEngine({ tex, config: on }), (e) => e.code === "COMPILE_FAILED");
});

test("sandbox blocks writes outside the work dir", opts, async () => {
  const target = path.join(dir, "written.txt");
  const tex = doc(`\\immediate\\openout3=${target} \\immediate\\write3{x}`);
  await runEngine({ tex, config: on }).catch(() => {});
  await assert.rejects(readFile(target), { code: "ENOENT" });
});

test("sandbox allows package downloads on a cold cache (network + cache writes work)", opts, async () => {
  const cold = loadConfig({ ...base, LATEX2PDF_SANDBOX: "on", TECTONIC_CACHE_DIR: path.join(dir, "cold-cache") });
  const { pdf } = await runEngine({ tex: doc("cold cache"), config: cold });
  assert.equal(countPages(pdf), 1);
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createToolMaster } from "../../index.mjs";
import { resolveEngine } from "../../engines.mjs";
import { runProcess } from "../../process.mjs";
import { SANDBOX_EXEC } from "../../sandbox.mjs";
import { tectonic } from "../../../engines/tectonic.mjs";
import { pandoc } from "../../../engines/pandoc.mjs";
import { countPages } from "../../../tools/latex-to-pdf/pdf.mjs";

const tm = await createToolMaster({ env: { ...process.env, TOOLMASTER_SANDBOX: "on", TOOLMASTER_TIMEOUT_MS: "120000" } });
const hasSandbox = await access(SANDBOX_EXEC).then(() => true, () => false);
const have = async (spec) => resolveEngine(tm.config, spec).then(() => true, () => false);
const skipFor = async (spec) => (!(await have(spec)) ? `${spec.id} not installed` : !hasSandbox ? "no OS sandbox on this platform" : false);
const tectonicOpts = { skip: await skipFor(tectonic) };
const pandocOpts = { skip: await skipFor(pandoc) };

let dir;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tm-sbx-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const cache = path.join(tm.config.cacheRoot, "tectonic");
const doc = (body) => `\\documentclass{article}\\begin{document}${body}\\end{document}`;
const typeset = async (tex, config = tm.config, cacheDir = cache) =>
  runProcess({
    command: await resolveEngine(config, tectonic),
    args: (d) => ["-X", "compile", "--untrusted", "--outdir", d, "main.tex"],
    files: { "main.tex": tex },
    outputs: ["main.pdf"],
    env: { TECTONIC_CACHE_DIR: cacheDir },
    rw: [cacheDir],
    config,
  });

test("sandboxed compile of a normal document still works", tectonicOpts, async () => {
  assert.equal(countPages((await typeset(doc("hello sandbox"))).outputs["main.pdf"]), 1);
});

test("sandbox blocks reading files outside the work dir even if the policy scan is bypassed", tectonicOpts, async () => {
  const secret = path.join(dir, "secret.tex");
  await writeFile(secret, "\\def\\x{TOPSECRET}");
  await assert.rejects(typeset(doc(`\\input{${secret}}\\x`)), { code: "TOOL_FAILED" });
});

test("sandbox blocks reading the user's home directory", tectonicOpts, async () => {
  await assert.rejects(typeset(doc(`\\input{${path.join(os.homedir(), ".zshrc")}}`)), { code: "TOOL_FAILED" });
});

test("sandbox blocks writes outside the work dir", tectonicOpts, async () => {
  const target = path.join(dir, "written.txt");
  await typeset(doc(`\\immediate\\openout3=${target} \\immediate\\write3{x}`)).catch(() => {});
  await assert.rejects(readFile(target), { code: "ENOENT" });
});

test("sandbox allows package downloads on a cold cache (network + cache writes work)", tectonicOpts, async () => {
  const cold = path.join(dir, "cold-cache");
  assert.equal(countPages((await typeset(doc("cold cache"), tm.config, cold)).outputs["main.pdf"]), 1);
});

test("pandoc runs sandboxed with the network denied, and cannot read files outside its work dir", pandocOpts, async () => {
  const secret = path.join(dir, "p-secret.tex");
  await writeFile(secret, "TOPSECRETMARKER");
  const convert = async (tex) =>
    runProcess({
      command: await resolveEngine(tm.config, pandoc),
      args: ["-f", "latex", "-t", "html5", "-o", "out.html", "input.txt"],
      files: { "input.txt": tex },
      outputs: ["out.html"],
      network: false,
      config: tm.config,
    });
  const ok = await convert("\\section{Hi}");
  assert.match(ok.outputs["out.html"].toString(), /Hi/);
  // No --sandbox flag here on purpose: the OS sandbox alone must stop the read.
  const leaked = await convert(`\\input{${secret}}`).then((r) => r.outputs["out.html"].toString(), () => "");
  assert.ok(!leaked.includes("TOPSECRETMARKER"));
});

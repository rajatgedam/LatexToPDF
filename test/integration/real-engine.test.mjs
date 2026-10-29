import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, access, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../src/config.mjs";
import { createCompiler } from "../../src/compile.mjs";
import { runEngine, engineInfo } from "../../src/engine.mjs";
import { countPages as pages } from "../../src/pdf.mjs";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = loadConfig({ LATEX2PDF_TIMEOUT_MS: "120000" });
const hasEngine = (await engineInfo(config)).found;
const opts = { skip: hasEngine ? false : "tectonic not installed (npm run install:engine)" };

let dir;
let compiler;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "l2p-int-"));
  compiler = createCompiler(config);
});
after(() => rm(dir, { recursive: true, force: true }));

test("compiles the example resume to a one-page PDF", opts, async () => {
  const source = await readFile(path.join(root, "examples/resume.tex"), "utf8");
  const r = await compiler.compile({ source });
  assert.equal(r.pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(pages(r.pdf), 1);
  assert.ok(r.warnings.some((w) => w.startsWith("compat:")));
});

test("warm compile stays fast (performance budget: 10 s)", opts, async () => {
  const source = await readFile(path.join(root, "examples/resume.tex"), "utf8");
  const t0 = performance.now();
  await compiler.compile({ source });
  assert.ok(performance.now() - t0 < 10_000, `took ${Math.round(performance.now() - t0)} ms`);
});

test("fragment and plain-text modes produce PDFs", opts, async () => {
  const frag = await compiler.compile({ source: "\\section*{Hello}\nA fragment with \\textbf{bold}." });
  assert.equal(frag.kind, "fragment");
  assert.equal(pages(frag.pdf), 1);
  const text = await compiler.compile({ source: "Plain text with $ & % # _ special chars.\n\nSecond paragraph." });
  assert.equal(text.kind, "text");
  assert.equal(pages(text.pdf), 1);
});

test("unicode content compiles", opts, async () => {
  const r = await compiler.compile({ source: "Résumé — naïve café ✓ Zoë Müller", mode: "text" });
  assert.equal(pages(r.pdf), 1);
});

test("LaTeX errors surface as COMPILE_FAILED with a readable log", opts, async () => {
  await assert.rejects(
    compiler.compile({ source: "\\documentclass{article}\\begin{document}\\notacommand\\end{document}" }),
    (e) => e.code === "COMPILE_FAILED" && /Undefined control sequence/.test(e.log),
  );
});

test("a runaway document is killed on timeout and leaves no process behind", opts, async () => {
  const src = "\\documentclass{article}\\begin{document}\\def\\x{\\x}\\x\\end{document}";
  const t0 = Date.now();
  await assert.rejects(compiler.compile({ source: src, timeoutMs: 3000 }), { code: "TIMEOUT" });
  assert.ok(Date.now() - t0 < 10_000);
  const ps = await run("ps", ["-eo", "command"]).catch(() => ({ stdout: "" }));
  assert.ok(!/tectonic.*l2p-work-/.test(ps.stdout), "engine process still running");
});

test("two concurrent compiles both succeed", opts, async () => {
  const [a, b] = await Promise.all([compiler.compile({ source: "one", mode: "text" }), compiler.compile({ source: "two", mode: "text" })]);
  assert.equal(pages(a.pdf) + pages(b.pdf), 2);
});

// Defense in depth: bypass the static policy scan and hit the engine directly.
test("engine --untrusted blocks shell escape even without the policy scan", opts, async () => {
  const marker = path.join(dir, "pwned");
  const tex = `\\documentclass{article}\\begin{document}\\immediate\\write18{touch ${marker}}x\\end{document}`;
  await runEngine({ tex, config }).catch(() => {});
  await assert.rejects(access(marker), { code: "ENOENT" });
});

// Tectonic --untrusted still reads absolute paths (verified 2026-10-28), so the policy scan is the barrier.
test("absolute-path input is rejected by the policy layer before reaching the engine", opts, async () => {
  const secret = path.join(dir, "secret.tex");
  await writeFile(secret, "TOPSECRETMARKER");
  await assert.rejects(
    compiler.compile({ source: `\\documentclass{article}\\begin{document}\\input{${secret}}\\end{document}` }),
    { code: "POLICY_VIOLATION" },
  );
});

test("CLI end to end: file in, PDF out, JSON result", opts, async () => {
  const output = path.join(dir, "cli.pdf");
  const { stdout } = await run(process.execPath, [path.join(root, "bin/latex2pdf.mjs"), "-i", path.join(root, "examples/resume.tex"), "-o", output, "--json"]);
  const j = JSON.parse(stdout);
  assert.equal(j.ok, true);
  assert.equal(pages(await readFile(output)), 1);
});

test("CLI exit code 3 for policy violations and no output file", opts, async () => {
  const input = path.join(dir, "evil.tex");
  const output = path.join(dir, "evil.pdf");
  await writeFile(input, "\\documentclass{article}\\begin{document}\\immediate\\write18{id}\\end{document}");
  await assert.rejects(run(process.execPath, [path.join(root, "bin/latex2pdf.mjs"), "-i", input, "-o", output]), (e) => e.code === 3);
  await assert.rejects(access(output), { code: "ENOENT" });
});

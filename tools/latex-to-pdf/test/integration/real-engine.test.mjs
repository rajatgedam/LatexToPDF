import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createToolMaster } from "../../../../core/index.mjs";
import { resolveEngine } from "../../../../core/engines.mjs";
import { runProcess } from "../../../../core/process.mjs";
import { countPages } from "../../pdf.mjs";
import tool from "../../tool.mjs";
import { SAMPLE } from "../../sample.mjs";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const tm = await createToolMaster({ env: { ...process.env, TOOLMASTER_TIMEOUT_MS: "120000" }, tools: [tool] });
const ready = (await tm.runner.status({ fresh: true }))["latex-to-pdf"].ready;
const opts = { skip: ready ? false : "tectonic not installed (node bin/toolmaster.mjs install latex-to-pdf)" };
const compile = (input, options) => tm.runner.run("latex-to-pdf", { input, options });

let dir;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tm-int-pdf-"));
});
after(() => rm(dir, { recursive: true, force: true }));

test("compiles the sample resume to a one-page PDF", opts, async () => {
  const r = await compile(SAMPLE);
  assert.equal(r.data.subarray(0, 5).toString(), "%PDF-");
  assert.equal(r.meta.pages, 1);
  assert.ok(r.warnings.some((w) => w.startsWith("compat:")));
});

test("warm compile stays fast (performance budget: 10 s)", opts, async () => {
  const t0 = performance.now();
  await compile(SAMPLE);
  assert.ok(performance.now() - t0 < 10_000, `took ${Math.round(performance.now() - t0)} ms`);
});

test("fragment and plain-text modes produce PDFs", opts, async () => {
  const frag = await compile("\\section*{Hello}\nA fragment with \\textbf{bold}.");
  assert.equal(frag.meta.kind, "fragment");
  assert.equal(frag.meta.pages, 1);
  const text = await compile("Plain text with $ & % # _ special chars.\n\nSecond paragraph.");
  assert.equal(text.meta.kind, "text");
  assert.equal(text.meta.pages, 1);
});

test("unicode content compiles", opts, async () => {
  assert.equal((await compile("Résumé — naïve café ✓ Zoë Müller", { mode: "text" })).meta.pages, 1);
});

test("LaTeX errors surface as TOOL_FAILED with a readable log", opts, async () => {
  await assert.rejects(compile("\\documentclass{article}\\begin{document}\\notacommand\\end{document}"), (e) => e.code === "TOOL_FAILED" && /Undefined control sequence/.test(e.log));
});

test("a runaway document is killed on timeout and leaves no process behind", opts, async () => {
  const src = "\\documentclass{article}\\begin{document}\\def\\x{\\x}\\x\\end{document}";
  const t0 = Date.now();
  await assert.rejects(tm.runner.run("latex-to-pdf", { input: src, timeoutMs: 3000 }), { code: "TIMEOUT" });
  assert.ok(Date.now() - t0 < 10_000);
  const ps = await run("ps", ["-eo", "command"]).catch(() => ({ stdout: "" }));
  assert.ok(!/tectonic.*tm-work-/.test(ps.stdout), "engine process still running");
});

test("two concurrent compiles both succeed", opts, async () => {
  const [a, b] = await Promise.all([compile("one", { mode: "text" }), compile("two", { mode: "text" })]);
  assert.equal(a.meta.pages + b.meta.pages, 2);
});

// Defense in depth: bypass the tool's policy scan and hit the engine directly.
test("engine --untrusted blocks shell escape even without the policy scan", opts, async () => {
  const marker = path.join(dir, "pwned");
  const spec = tm.engines.get("tectonic");
  const command = await resolveEngine(tm.config, spec);
  const tex = `\\documentclass{article}\\begin{document}\\immediate\\write18{touch ${marker}}x\\end{document}`;
  await runProcess({ command, args: (d) => ["-X", "compile", "--untrusted", "--outdir", d, "main.tex"], files: { "main.tex": tex }, outputs: ["main.pdf"], config: tm.config, env: { TECTONIC_CACHE_DIR: path.join(tm.config.cacheRoot, "tectonic") }, rw: [path.join(tm.config.cacheRoot, "tectonic")] }).catch(() => {});
  await assert.rejects(access(marker), { code: "ENOENT" });
});

// Tectonic --untrusted still reads absolute paths (verified 2026-10-28), so the policy scan is the barrier.
test("absolute-path input is rejected by the policy layer before reaching the engine", opts, async () => {
  const secret = path.join(dir, "secret.tex");
  await writeFile(secret, "TOPSECRETMARKER");
  await assert.rejects(compile(`\\documentclass{article}\\begin{document}\\input{${secret}}\\end{document}`), { code: "POLICY_VIOLATION" });
});

test("CLI end to end: file in, PDF out, JSON result", opts, async () => {
  const input = path.join(dir, "in.tex");
  const output = path.join(dir, "cli.pdf");
  await writeFile(input, SAMPLE);
  const { stdout } = await run(process.execPath, [path.join(root, "bin/toolmaster.mjs"), "latex-to-pdf", "-i", input, "-o", output, "--json"]);
  const j = JSON.parse(stdout);
  assert.equal(j.ok, true);
  assert.equal(countPages(await readFile(output)), 1);
});

test("CLI exits 3 for policy violations and writes no output file", opts, async () => {
  const input = path.join(dir, "evil.tex");
  const output = path.join(dir, "evil.pdf");
  await writeFile(input, "\\documentclass{article}\\begin{document}\\immediate\\write18{id}\\end{document}");
  await assert.rejects(run(process.execPath, [path.join(root, "bin/toolmaster.mjs"), "latex-to-pdf", "-i", input, "-o", output]), (e) => e.code === 3);
  await assert.rejects(access(output), { code: "ENOENT" });
});

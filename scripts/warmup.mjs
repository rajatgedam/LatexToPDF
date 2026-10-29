#!/usr/bin/env node
// Primes the Tectonic package cache with common resume packages so later runs can use LATEX2PDF_OFFLINE=1.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCompiler } from "../src/compile.mjs";
import { loadConfig } from "../src/config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compiler = createCompiler(loadConfig({ ...process.env, LATEX2PDF_TIMEOUT_MS: "300000", LATEX2PDF_OFFLINE: "" }));

const packages = [
  "geometry", "hyperref", "enumitem", "titlesec", "xcolor", "fancyhdr", "tabularx", "multicol", "parskip",
  "array", "longtable", "graphicx", "amsmath", "amssymb", "fontspec", "microtype", "ragged2e", "setspace",
  "fullpage", "latexsym", "marvosym", "babel", "booktabs", "url", "paracol", "supertabular", "tikz",
];
const sources = [
  await readFile(path.join(root, "examples", "resume.tex"), "utf8"),
  `\\documentclass{article}\n${packages.map((p) => `\\usepackage{${p}}`).join("\n")}\n\\begin{document}warm\\end{document}`,
];

for (const source of sources) {
  const r = await compiler.compile({ source }).catch((e) => ({ error: `${e.code}: ${e.message}` }));
  console.log(r.error ? `warmup step failed (${r.error})` : `warmup ok (${r.durationMs} ms)`);
}

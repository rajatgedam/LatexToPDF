import { defineTool, ToolMasterError } from "../../core/sdk.mjs";
import { normalizeInput, MODES } from "./input.mjs";
import { applyCompat } from "./compat.mjs";
import { assertSafe } from "./validate.mjs";
import { countPages } from "./pdf.mjs";
import { SAMPLE } from "./sample.mjs";

const MAX_WARNINGS = 20;
const extractWarnings = (log) => (log.match(/^warning:.*$/gm) ?? []).slice(0, MAX_WARNINGS);

async function typeset(ctx, input, options) {
  const { tex: normalized, kind } = normalizeInput(input, { mode: options.mode, maxBytes: ctx.limits.maxInputBytes });
  const { tex, notes } = applyCompat(normalized);
  assertSafe(tex);
  const cache = await ctx.cacheDir("tectonic");
  const { outputs, log } = await ctx.exec({
    engine: "tectonic",
    label: "Tectonic",
    files: { "main.tex": tex },
    outputs: ["main.pdf"],
    args: (dir) => ["-X", "compile", "--untrusted", "--print", "--outdir", dir, ...(ctx.config.offline ? ["--only-cached"] : []), "main.tex"],
    env: { TECTONIC_CACHE_DIR: cache },
    rw: [cache],
    network: !ctx.config.offline,
  });
  const pdf = outputs["main.pdf"];
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ToolMasterError("TOOL_FAILED", "Engine did not produce a valid PDF", { log });
  return { data: pdf, meta: { pages: countPages(pdf), kind }, warnings: [...notes, ...extractWarnings(log)] };
}

const WARM_PACKAGES = [
  "geometry", "hyperref", "enumitem", "titlesec", "xcolor", "fancyhdr", "tabularx", "multicol", "parskip",
  "array", "longtable", "graphicx", "amsmath", "amssymb", "fontspec", "microtype", "ragged2e", "setspace",
  "fullpage", "latexsym", "marvosym", "babel", "booktabs", "url", "paracol", "supertabular", "tikz",
];

export default defineTool({
  manifest: {
    id: "latex-to-pdf",
    name: "LaTeX to PDF",
    description: "Typeset LaTeX (or plain text) into a print-ready PDF. Great for resumes.",
    useWhen: "You have LaTeX source (a resume, paper or letter) and need a PDF. No TeX installation required; do not write your own pdflatex wrapper.",
    category: "Documents",
    icon: "📄",
    tags: ["latex", "tex", "pdf", "resume", "typeset"],
    version: "1.0.0",
    input: { kind: "text", accept: [".tex", ".latex", ".txt"] },
    output: { contentType: "application/pdf", extension: "pdf" },
    preview: "file",
    options: [{ id: "mode", label: "Input type", type: "enum", values: MODES, default: "auto" }],
    engines: ["tectonic"],
    ui: { action: "Compile" },
    sample: SAMPLE,
  },
  run: (ctx, { input, options }) => typeset(ctx, input, options),
  async warmup(ctx) {
    await typeset(ctx, SAMPLE, { mode: "auto" });
    await typeset(ctx, `\\documentclass{article}\n${WARM_PACKAGES.map((p) => `\\usepackage{${p}}`).join("\n")}\n\\begin{document}warm\\end{document}`, { mode: "latex" });
  },
});

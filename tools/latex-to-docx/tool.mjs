import { defineTool, ToolMasterError } from "../../core/sdk.mjs";
import { pandoc } from "./engine.mjs";
import { SAMPLE } from "./sample.mjs";
import { lockDown } from "./preview.mjs";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ERROR_LINE = /^(?:pandoc:|Error|\[ERROR\]).*$/m;
const MAX_WARNINGS = 20;

/** `auto` treats text with LaTeX commands as LaTeX, anything else as plain text (Markdown without raw HTML/TeX). */
function pickFormat(text, mode) {
  const latex = mode === "latex" || (mode === "auto" && /(^|[^\\])\\[A-Za-z]+/.test(text.replace(/(^|[^\\])%.*$/gm, "$1")));
  return latex ? { name: "latex", from: "latex" } : { name: "text", from: "markdown-raw_html-raw_tex" };
}

// Pandoc's own --sandbox blocks file, network and process access from the document; the OS sandbox and temp dir are extra layers.
const baseArgs = (from) => ["--sandbox", "-f", from, "--wrap=none"];

async function convert(ctx, input, { mode, toc }, target) {
  const text = input.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
  const { name, from } = pickFormat(text, mode);
  const isDocx = target === "docx";
  const out = isDocx ? "out.docx" : "out.html";
  const { outputs, log } = await ctx.exec({
    engine: "pandoc",
    label: "Pandoc",
    files: { "input.txt": text },
    outputs: [out],
    args: [...baseArgs(from), "-t", isDocx ? "docx" : "html5", ...(isDocx ? [] : ["-s", "--mathml"]), ...(toc && isDocx ? ["--toc"] : []), "-o", out, "input.txt"],
    errorPattern: ERROR_LINE,
    network: false,
  });
  return { data: outputs[out], kind: name, warnings: (log.match(/^\[WARNING\].*$/gm) ?? []).slice(0, MAX_WARNINGS) };
}

export default defineTool({
  manifest: {
    id: "latex-to-docx",
    name: "LaTeX to DOCX",
    description: "Turn LaTeX into an editable Word document. Headings, lists, tables, links and math carry over.",
    category: "Documents",
    icon: "📝",
    tags: ["latex", "tex", "docx", "word", "convert"],
    version: "1.0.0",
    input: { kind: "text", accept: [".tex", ".latex", ".txt"] },
    output: { contentType: DOCX, extension: "docx" },
    preview: "html",
    options: [
      { id: "mode", label: "Input type", type: "enum", values: ["auto", "latex", "text"], default: "auto" },
      { id: "toc", label: "Add a table of contents", type: "boolean", default: false },
    ],
    engines: [pandoc],
    ui: { action: "Convert" },
    sample: SAMPLE,
  },
  async run(ctx, { input, options }) {
    const { data, kind, warnings } = await convert(ctx, input, options, "docx");
    if (data.subarray(0, 2).toString("latin1") !== "PK") throw new ToolMasterError("TOOL_FAILED", "Pandoc did not produce a valid DOCX file");
    return { data, meta: { kind }, warnings };
  },
  async preview(ctx, { input, options }) {
    const { data } = await convert(ctx, input, options, "html");
    return { data: Buffer.from(lockDown(data.toString("utf8")), "utf8"), contentType: "text/html; charset=utf-8" };
  },
});

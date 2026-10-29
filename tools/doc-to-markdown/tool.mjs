import { defineTool, ToolMasterError } from "../../core/sdk.mjs";
import { sniff, TYPES, PANDOC_READER, tidyMarkdown } from "./sniff.mjs";
import { pdfText } from "./worker.mjs";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_WARNINGS = 20;
const ERROR_LINE = /^(?:pandoc:|Error|\[ERROR\]).*$/m;

async function viaPandoc(ctx, input, kind) {
  const { outputs, log } = await ctx.exec({
    engine: "pandoc",
    label: "Pandoc",
    files: { "input.bin": input },
    outputs: ["out.md"],
    // --sandbox: the document cannot make pandoc read other files, fetch URLs or run programs.
    args: ["--sandbox", "-f", PANDOC_READER[kind], "-t", "gfm", "--wrap=none", "-o", "out.md", "input.bin"],
    errorPattern: ERROR_LINE,
    network: false,
  });
  return { markdown: outputs["out.md"].toString("utf8"), warnings: (log.match(/^\[WARNING\].*$/gm) ?? []).slice(0, MAX_WARNINGS) };
}

async function viaPdf(ctx, input, options) {
  const { result, outputs } = await ctx.isolate({ job: "pdf-text", request: { options }, files: { "input.pdf": input }, outputs: ["out.md"] });
  const warnings = result.emptyPages === result.pages ? ["No text found: this looks like a scanned PDF. OCR is not included."] : result.emptyPages ? [`${result.emptyPages} page(s) had no text (scanned or image-only)`] : [];
  return { markdown: outputs["out.md"].toString("utf8"), warnings, pages: result.pages };
}

export default defineTool({
  manifest: {
    id: "doc-to-markdown",
    name: "Doc to Markdown",
    description: "Read PDF, Word, PowerPoint, Excel, EPUB, ODT, RTF, HTML, CSV and LaTeX files as clean Markdown that an AI (or a person) can read.",
    useWhen: "You must read what is inside a PDF, DOCX, PPTX, XLSX, EPUB, ODT, RTF, HTML or CSV file. Do not write a pdftotext / python-docx / openpyxl script: run this and read the Markdown.",
    category: "AI Helpers",
    icon: "🤖",
    tags: ["markdown", "pdf", "docx", "pptx", "xlsx", "epub", "extract", "text", "llm", "ai"],
    version: "1.0.0",
    input: { kind: "binary", accept: [".pdf", ".docx", ".pptx", ".xlsx", ".odt", ".epub", ".html", ".htm", ".rtf", ".csv", ".tsv", ".tex", ".ipynb", ".txt"], maxBytes: MAX_BYTES },
    output: { contentType: "text/markdown; charset=utf-8", extension: "md" },
    preview: "text",
    options: [
      { id: "type", label: "File type", type: "enum", values: ["auto", ...TYPES], default: "auto", help: "auto looks at the bytes, not the file name" },
      { id: "markers", label: "Mark PDF page breaks", type: "boolean", default: true, help: "adds <!-- page N --> lines so you can cite pages" },
    ],
    engines: ["pandoc"],
    ui: { action: "Read it" },
  },
  workers: { "pdf-text": pdfText },
  async run(ctx, { input, options }) {
    const kind = options.type === "auto" ? sniff(input) : options.type;
    if (!kind) throw new ToolMasterError("INPUT_INVALID", "Unsupported file: expected a PDF, DOCX, PPTX, XLSX, ODT, EPUB, HTML, RTF, CSV, TSV, LaTeX, notebook or plain text file");
    let r;
    if (kind === "pdf") r = await viaPdf(ctx, input, options);
    else if (kind === "text") {
      try {
        r = { markdown: new TextDecoder("utf-8", { fatal: true }).decode(input), warnings: [] };
      } catch {
        throw new ToolMasterError("INPUT_INVALID", "That file is not valid UTF-8 text");
      }
    } else r = await viaPandoc(ctx, input, kind);
    const markdown = tidyMarkdown(r.markdown);
    return { data: Buffer.from(markdown, "utf8"), meta: { kind, chars: markdown.length, ...(r.pages ? { pages: r.pages } : {}) }, warnings: r.warnings };
  },
});

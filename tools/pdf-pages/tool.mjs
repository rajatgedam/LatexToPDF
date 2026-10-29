import { defineTool, ToolMasterError } from "../../core/sdk.mjs";
import { checkPageSyntax } from "./pages.mjs";
import { arrange } from "./worker.mjs";

const PDF_MAX_BYTES = 25 * 1024 * 1024;
const looksLikePdf = (bytes) => bytes.subarray(0, 1024).includes("%PDF-");

export default defineTool({
  manifest: {
    id: "pdf-pages",
    name: "PDF Pages",
    description: "Pick, reorder, reverse, repeat, delete or rotate PDF pages. Splitting is extracting a range.",
    useWhen: "You need part of a PDF, a different page order, or rotated/removed pages. Do not write your own PyPDF/qpdf script. Run it once per piece to split a file.",
    category: "PDF",
    icon: "📑",
    tags: ["pdf", "split", "extract", "reorder", "rotate", "delete", "pages"],
    version: "1.0.0",
    input: { kind: "binary", accept: [".pdf"], maxBytes: PDF_MAX_BYTES },
    output: { contentType: "application/pdf", extension: "pdf" },
    preview: "file",
    options: [
      {
        id: "pages", label: "Pages to keep, in order", type: "string", default: "all", maxLength: 500,
        help: "Examples: 1-3 | 3,1,2 | all,!2 (drop page 2) | r1,1-r2 (last page first) | 5-2 (reversed) | odd | even | 4-end",
      },
      { id: "rotate", label: "Rotate the kept pages (degrees clockwise)", type: "enum", values: ["0", "90", "180", "270"], default: "0" },
    ],
    ui: { action: "Make PDF" },
  },
  workers: { arrange },
  async run(ctx, { input, options }) {
    if (!looksLikePdf(input)) throw new ToolMasterError("INPUT_INVALID", "That file does not look like a PDF");
    checkPageSyntax(options.pages);
    const { result, outputs } = await ctx.isolate({ job: "arrange", request: { options }, files: { "input.pdf": input }, outputs: ["out.pdf"] });
    return { data: outputs["out.pdf"], meta: result };
  },
});

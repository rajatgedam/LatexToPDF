import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ToolMasterError } from "../../core/sdk.mjs";

const MAX_PAGES = 1000;

/** Join text items into lines and paragraphs using their positions (PDF text has no real line structure). */
export function layoutText(items) {
  const lines = [];
  let line = null;
  for (const it of items) {
    if (typeof it.str !== "string" || !it.transform) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = Math.abs(it.height || it.transform[3]) || 10;
    if (line && Math.abs(y - line.y) <= Math.max(2, h * 0.5)) {
      const gap = x - line.end;
      const needsSpace = gap > h * 0.15 && !line.text.endsWith(" ") && !it.str.startsWith(" ");
      line.text += (needsSpace ? " " : "") + it.str;
      line.end = x + (it.width || 0);
    } else {
      if (line) lines.push(line);
      line = { y, h, text: it.str, end: x + (it.width || 0) };
    }
  }
  if (line) lines.push(line);
  const out = [];
  lines.forEach((l, i) => {
    const text = l.text.replace(/[ \t]+/g, " ").trim();
    if (!text) return;
    if (i > 0 && lines[i - 1].y - l.y > l.h * 1.8) out.push("");
    out.push(text);
  });
  return out.join("\n");
}

/** Runs inside the isolated worker: input.pdf + request.json in `dir` -> out.md. */
export async function pdfText({ dir }) {
  const { options } = JSON.parse(await readFile(path.join(dir, "request.json"), "utf8"));
  const bytes = await readFile(path.join(dir, "input.pdf"));
  // Handing pdf.js its worker in-process keeps it from looking for a worker file next to the (bundled) program.
  globalThis.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false, verbosity: 0 }).promise;
  } catch (err) {
    const locked = err?.name === "PasswordException";
    throw new ToolMasterError("INPUT_INVALID", locked ? "This PDF is password-protected; remove the password first" : "Could not read this PDF (it may be damaged)");
  }
  if (doc.numPages > MAX_PAGES) throw new ToolMasterError("INPUT_INVALID", `This PDF has ${doc.numPages} pages; the limit is ${MAX_PAGES}. Cut it down with the pdf-pages tool first`);

  const parts = [];
  let empty = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const text = layoutText((await page.getTextContent()).items);
    if (!text) empty++;
    parts.push(options.markers ? `<!-- page ${n} -->\n\n${text}` : text);
    page.cleanup();
  }
  await writeFile(path.join(dir, "out.md"), parts.join("\n\n"));
  return { pages: doc.numPages, emptyPages: empty };
}

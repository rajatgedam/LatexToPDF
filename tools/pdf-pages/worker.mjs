import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ToolMasterError } from "../../core/sdk.mjs";
import { parsePageExpr } from "./pages.mjs";

/** Runs inside the isolated worker process: reads input.pdf + request.json from `dir`, writes out.pdf. */
export async function arrange({ dir }) {
  const { options } = JSON.parse(await readFile(path.join(dir, "request.json"), "utf8"));
  const bytes = await readFile(path.join(dir, "input.pdf"));
  const { PDFDocument, degrees } = await import("@cantoo/pdf-lib");

  let source;
  let total;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
    total = source.getPageCount();
  } catch (err) {
    const locked = /encrypt|password/i.test(`${err?.name} ${err?.message}`);
    throw new ToolMasterError("INPUT_INVALID", locked ? "This PDF is password-protected; remove the password first" : "Could not read this PDF (it may be damaged)");
  }

  const picks = parsePageExpr(options.pages, total);
  const rotation = Number(options.rotate);
  const out = await PDFDocument.create();
  for (const page of await out.copyPages(source, picks)) {
    if (rotation) page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
    out.addPage(page);
  }
  for (const [get, set] of [["getTitle", "setTitle"], ["getAuthor", "setAuthor"], ["getSubject", "setSubject"]]) {
    const value = source[get]();
    if (value) out[set](value);
  }
  out.setProducer("ToolMaster");
  await writeFile(path.join(dir, "out.pdf"), await out.save());
  return { sourcePages: total, pages: picks.length };
}

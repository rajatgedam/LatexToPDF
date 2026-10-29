const PDF_MARK = "%PDF-";
const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Kinds this tool can read; `type=auto` picks one by looking at the bytes, never at a file name. */
export const TYPES = ["pdf", "docx", "pptx", "xlsx", "odt", "epub", "html", "rtf", "csv", "tsv", "latex", "ipynb", "text"];

function decode(buf) {
  try {
    return utf8.decode(buf.subarray(0, 8192));
  } catch {
    // a multi-byte character may be cut at the 8 KiB boundary: retry on a trimmed slice
    try {
      return utf8.decode(buf.subarray(0, 8190));
    } catch {
      return null;
    }
  }
}

function sniffText(text) {
  if (/^\s*(?:<!doctype html|<html|<\?xml[^>]*>\s*<html)/i.test(text)) return "html";
  if (text.startsWith("{\\rtf")) return "rtf";
  if (/^\s*\{/.test(text) && /"nbformat"\s*:/.test(text)) return "ipynb";
  if (/\\documentclass|\\begin\{document\}|\\section\{/.test(text)) return "latex";
  const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 6);
  if (lines.length >= 2) {
    const count = (ch) => lines.map((l) => l.split(ch).length - 1);
    const tabs = count("\t");
    if (tabs[0] > 0 && tabs.every((n) => n === tabs[0])) return "tsv";
    const commas = count(",");
    if (commas[0] > 0 && commas.every((n) => n === commas[0])) return "csv";
  }
  return "text";
}

/** Returns one of TYPES, or null when the bytes are neither a known document nor valid UTF-8 text. */
export function sniff(buf) {
  if (buf.subarray(0, 1024).includes(PDF_MARK)) return "pdf";
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    if (buf.includes("word/document.xml")) return "docx";
    if (buf.includes("ppt/presentation.xml")) return "pptx";
    if (buf.includes("xl/workbook.xml")) return "xlsx";
    const head = buf.subarray(0, 512);
    if (head.includes("application/epub+zip")) return "epub";
    if (head.includes("application/vnd.oasis.opendocument.text")) return "odt";
    return null;
  }
  const text = decode(buf);
  return text === null ? null : sniffText(text);
}

/** Pandoc reader name for each pandoc-backed kind. */
export const PANDOC_READER = { docx: "docx", pptx: "pptx", xlsx: "xlsx", odt: "odt", epub: "epub", html: "html", rtf: "rtf", csv: "csv", tsv: "tsv", latex: "latex", ipynb: "ipynb" };

/** Markdown for an AI to read: drop image links (they point at files that are not there), trim trailing spaces, collapse blank runs. */
export function tidyMarkdown(md) {
  return `${md
    .replace(/\r\n?/g, "\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)(\{[^}]*\})?/g, (_m, alt) => (alt.trim() ? `[image: ${alt.trim()}]` : "[image]"))
    .replace(/<\/?span[^>]*>/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

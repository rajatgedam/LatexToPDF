import { inflateRawSync } from "node:zlib";

/** Reads one entry of a DOCX (zip) from its central directory; returns it as UTF-8 text. */
export function docxPart(buf, name) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file");
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const [nameLen, extraLen, commentLen] = [28, 30, 32].map((o) => buf.readUInt16LE(p + o));
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString("utf8", p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`no ${name} in the package`);
}

/** Paragraphs of word/document.xml as { style, text } with line breaks shown as "\n". */
export function docxParagraphs(buf) {
  const xml = docxPart(buf, "word/document.xml");
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) => ({
    style: /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? "",
    bullet: p.includes("<w:numPr>"),
    text: p.replace(/<w:br\s*\/>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
  }));
}

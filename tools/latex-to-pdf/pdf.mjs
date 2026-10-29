import { inflateSync } from "node:zlib";

const MAX_INFLATED = 64 * 1024 * 1024;
const PAGE_RE = /\/Type\s*\/Page(?![A-Za-z])/g;

/** Count pages by scanning page objects, including those inside Flate-compressed object streams. */
export function countPages(pdf) {
  const raw = pdf.toString("latin1");
  let count = (raw.match(PAGE_RE) ?? []).length;
  let budget = MAX_INFLATED;
  for (const m of raw.matchAll(/\/Type\s*\/ObjStm[^]*?stream\r?\n/g)) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0 || budget <= 0) break;
    try {
      const inflated = inflateSync(pdf.subarray(start, end), { maxOutputLength: budget }).toString("latin1");
      budget -= inflated.length;
      count += (inflated.match(PAGE_RE) ?? []).length;
    } catch {
      // not Flate data or corrupt: skip this stream
    }
  }
  return count;
}

import { ToolMasterError } from "../../core/sdk.mjs";

const MAX_TOKENS = 200;
const MAX_PICKS = 5000;
const POINT = /^(?:\d{1,6}|end|r\d{1,6})$/;
const bad = (msg) => new ToolMasterError("INPUT_INVALID", msg);

/**
 * Page expression: comma-separated tokens, evaluated left to right.
 *   3        page 3                    r2       second page from the end       end   last page
 *   2-5      pages 2 to 5              5-2      pages 5 down to 2 (reversed)   3-end pages 3 to the last
 *   all  odd  even                     !4  !2-3  remove those pages from what has been selected so far
 * Examples: "all,!2" drops page 2; "r1,1-r2" moves the last page to the front; "even" keeps every second page.
 */
export function tokenize(expr) {
  const text = String(expr ?? "").trim().toLowerCase();
  if (text === "") throw bad("pages must not be empty (use all to keep every page)");
  const parts = text.split(",").map((p) => p.trim());
  if (parts.length > MAX_TOKENS) throw bad(`pages has more than ${MAX_TOKENS} parts`);
  return parts.map((part) => {
    const negate = part.startsWith("!");
    const body = negate ? part.slice(1).trim() : part;
    if (["all", "odd", "even"].includes(body)) return { negate, kind: body };
    const [a, b, ...extra] = body.split("-").map((s) => s.trim());
    if (extra.length || !POINT.test(a ?? "") || (b !== undefined && !POINT.test(b))) throw bad(`"${part}" is not a page number or range (examples: 3, 2-5, 5-2, r1, 4-end, odd, !7)`);
    return { negate, kind: "range", from: a, to: b ?? a };
  });
}

/** Syntax check that needs no page count (the parent process runs this before starting a worker). */
export const checkPageSyntax = (expr) => void tokenize(expr);

const resolvePoint = (point, total, token) => {
  const n = point === "end" ? total : point.startsWith("r") ? total - Number(point.slice(1)) + 1 : Number(point);
  if (!Number.isInteger(n) || n < 1 || n > total) throw bad(`Page "${point}" in "${token}" does not exist: the document has ${total} page${total === 1 ? "" : "s"}`);
  return n;
};

/** Zero-based page indexes, in output order. */
export function parsePageExpr(expr, total) {
  const expand = (t, label) => {
    if (t.kind === "all") return Array.from({ length: total }, (_, i) => i + 1);
    if (t.kind === "odd") return Array.from({ length: Math.ceil(total / 2) }, (_, i) => i * 2 + 1);
    if (t.kind === "even") return Array.from({ length: Math.floor(total / 2) }, (_, i) => i * 2 + 2);
    const from = resolvePoint(t.from, total, label);
    const to = resolvePoint(t.to, total, label);
    return Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => (from <= to ? from + i : from - i));
  };
  const tokens = tokenize(expr);
  const labels = String(expr).split(",").map((s) => s.trim());
  let selected = tokens[0]?.negate ? Array.from({ length: total }, (_, i) => i + 1) : [];
  tokens.forEach((t, i) => {
    const pages = expand(t, labels[i]);
    selected = t.negate ? selected.filter((p) => !pages.includes(p)) : selected.concat(pages);
    if (selected.length > MAX_PICKS) throw bad(`pages selects more than ${MAX_PICKS} pages`);
  });
  if (selected.length === 0) throw bad("pages selects nothing: every page was removed");
  return selected.map((p) => p - 1);
}

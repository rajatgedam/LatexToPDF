// Tectonic is XeTeX-based; these pdfTeX-only directives are undefined there and abort the build.
const RULES = [
  { name: "\\input{glyphtounicode}", re: /^[ \t]*\\input\s*\{glyphtounicode\}[ \t]*(?:%.*)?$/ },
  { name: "\\pdfgentounicode", re: /^[ \t]*\\pdfgentounicode\s*=\s*\d+[ \t]*(?:%.*)?$/ },
  { name: "\\pdfoutput", re: /^[ \t]*\\pdfoutput\s*=\s*\d+[ \t]*(?:%.*)?$/ },
  { name: "\\pdfminorversion", re: /^[ \t]*\\pdfminorversion\s*=\s*\d+[ \t]*(?:%.*)?$/ },
  { name: "\\pdfcompresslevel", re: /^[ \t]*\\pdfcompresslevel\s*=\s*\d+[ \t]*(?:%.*)?$/ },
  { name: "\\pdfobjcompresslevel", re: /^[ \t]*\\pdfobjcompresslevel\s*=\s*\d+[ \t]*(?:%.*)?$/ },
];

/** Strip whole-line pdfTeX-only directives (line count is preserved for error messages). */
export function applyCompat(tex) {
  const notes = [];
  const out = tex.split("\n").map((line) => {
    const hit = RULES.find((r) => r.re.test(line));
    if (!hit) return line;
    notes.push(`compat: removed pdfTeX-only ${hit.name}`);
    return "";
  });
  return { tex: out.join("\n"), notes };
}

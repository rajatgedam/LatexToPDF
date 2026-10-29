import { ToolMasterError } from "../../core/sdk.mjs";

// Control words that read/write files, spawn processes or alter tokenization to evade this list.
const BANNED_WORDS = [
  "write", "newwrite", "immediate", "openout", "openin", "newread", "read", "readline",
  "include", "InputIfFileExists", "IfFileExists", "@input", "@iinput", "directlua", "luaexec",
  "csname", "catcode", "scantokens", "pdfshellescape", "verbatiminput", "VerbatimInput",
  "lstinputlisting", "openpipe", "special",
];

const BANNED_PACKAGES = new Set([
  "shellesc", "catchfile", "minted", "pythontex", "sagetex", "svg", "gnuplottex",
  "epstopdf", "write18", "bashful", "python", "texshell", "pst-pdf", "auto-pst-pdf",
]);

const SAFE_INPUT_NAME = /^[A-Za-z0-9_-]+$/;
// Tectonic --untrusted still allows absolute-path reads, so path-taking commands must not escape the work dir.
const PATH_COMMANDS = /\\(?:includegraphics|graphicspath|usepackage|RequirePackage|documentclass|LoadClass)\s*(?:\[[^\]]*\])?\s*\{+([^}]*)/g;
const ESCAPING_PATH = /(^|[\s{,])\/|\.\.|~|\\|:/;

const stripComment = (line) => line.replace(/(^|[^\\])%.*$/, "$1");
const word = (w) => new RegExp(`\\\\${w}(?![A-Za-z@])`);
const WORD_RULES = BANNED_WORDS.map((w) => ({ rule: w, re: word(w) }));

/** Scan source for forbidden constructs. This is defense in depth; the engine runs in untrusted mode too. */
export function findViolations(tex) {
  const violations = [];
  tex.split("\n").forEach((raw, i) => {
    const line = stripComment(raw);
    const at = i + 1;
    for (const { rule, re } of WORD_RULES) if (re.test(line)) violations.push({ rule, line: at });

    for (const m of line.matchAll(/\\input(?![A-Za-z@])\s*(?:\{([^}]*)\}|(\S+))/g)) {
      if (!SAFE_INPUT_NAME.test((m[1] ?? m[2] ?? "").trim())) violations.push({ rule: "input", line: at });
    }
    for (const m of line.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)) {
      for (const pkg of m[1].split(",")) {
        if (BANNED_PACKAGES.has(pkg.trim())) violations.push({ rule: `package:${pkg.trim()}`, line: at });
      }
    }
    if (/\\begin\s*\{filecontents\*?\}/.test(line)) violations.push({ rule: "filecontents", line: at });
    for (const m of line.matchAll(PATH_COMMANDS)) {
      if (ESCAPING_PATH.test(m[1])) violations.push({ rule: "path", line: at });
    }
    if (/\\XeTeXp(?:ic|df)file(?![A-Za-z@])/.test(line)) violations.push({ rule: "XeTeXpicfile", line: at });
  });
  return violations;
}

export function assertSafe(tex) {
  const violations = findViolations(tex);
  if (violations.length === 0) return;
  const shown = violations.slice(0, 5).map((v) => `${v.rule} (line ${v.line})`).join(", ");
  throw new ToolMasterError("POLICY_VIOLATION", `Forbidden LaTeX construct(s): ${shown}`, { details: violations });
}

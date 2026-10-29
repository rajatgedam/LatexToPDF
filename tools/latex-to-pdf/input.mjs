import { ToolMasterError } from "../../core/sdk.mjs";

export const MODES = Object.freeze(["auto", "latex", "fragment", "text"]);

const SPECIALS = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "&": "\\&",
  "#": "\\#",
  "^": "\\textasciicircum{}",
  _: "\\_",
  "%": "\\%",
  "~": "\\textasciitilde{}",
};

const PREAMBLE = "\\documentclass[11pt]{article}\n\\usepackage[margin=1in]{geometry}\n\\usepackage{hyperref}\n";

const stripComments = (s) => s.replace(/(^|[^\\])%.*$/gm, "$1");

/** Escape every TeX special character so plain text cannot inject commands. */
export function escapeText(s) {
  return s.replace(/[\\{}$&#^_%~]/g, (c) => SPECIALS[c]);
}

/** Classify source as a full document, a fragment of LaTeX, or plain text. */
export function classify(src) {
  const code = stripComments(src);
  if (/\\documentclass(?![A-Za-z])/.test(code)) return "latex";
  if (/\\[A-Za-z]+/.test(code)) return "fragment";
  return "text";
}

/**
 * Validate and normalize caller input into a complete LaTeX document.
 * @returns {{ tex: string, kind: "latex"|"fragment"|"text" }}
 */
export function normalizeInput(source, { mode = "auto", maxBytes }) {
  if (!MODES.includes(mode)) throw new ToolMasterError("INPUT_INVALID", `mode must be one of: ${MODES.join(", ")}`);
  if (typeof source !== "string") throw new ToolMasterError("INPUT_INVALID", "source must be a string");
  if (Buffer.byteLength(source, "utf8") > maxBytes) {
    throw new ToolMasterError("INPUT_TOO_LARGE", `Input exceeds ${maxBytes} bytes`);
  }
  if (source.includes("\0")) throw new ToolMasterError("INPUT_INVALID", "Input contains NUL bytes");
  const text = source.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
  if (text.trim() === "") throw new ToolMasterError("INPUT_EMPTY", "Input is empty");

  const kind = mode === "auto" ? classify(text) : mode;
  if (kind === "latex") {
    if (classify(text) !== "latex") throw new ToolMasterError("INPUT_INVALID", "mode=latex requires a \\documentclass");
    return { tex: text, kind };
  }
  if (kind === "fragment") {
    return { tex: `${PREAMBLE}\\begin{document}\n${text}\n\\end{document}\n`, kind };
  }
  const body = `\\setlength{\\parindent}{0pt}\\setlength{\\parskip}{0.8em}\n${escapeText(text)}`;
  return { tex: `${PREAMBLE}\\begin{document}\n${body}\n\\end{document}\n`, kind };
}

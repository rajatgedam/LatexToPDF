import { createCompiler } from "./compile.mjs";

export { createCompiler } from "./compile.mjs";
export { loadConfig } from "./config.mjs";
export { LatexToPdfError, ERROR_CODES } from "./errors.mjs";
export { findViolations } from "./validate.mjs";

let shared;
const compiler = () => (shared ??= createCompiler());

/** Compile LaTeX/plain text to a PDF Buffer using env-driven config. */
export const compile = (options) => compiler().compile(options);

/** Compile a file or string and write the PDF to `output` (atomic). */
export const compileToFile = (options) => compiler().compileToFile(options);

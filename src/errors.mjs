export const ERROR_CODES = Object.freeze([
  "CONFIG_INVALID",
  "INPUT_EMPTY",
  "INPUT_TOO_LARGE",
  "INPUT_INVALID",
  "POLICY_VIOLATION",
  "ENGINE_NOT_FOUND",
  "COMPILE_FAILED",
  "TIMEOUT",
  "OUTPUT_TOO_LARGE",
  "OUTPUT_PATH_INVALID",
  "BUSY",
]);

/** Error with a stable machine-readable `code`; `log` holds sanitized engine output. */
export class LatexToPdfError extends Error {
  constructor(code, message, { log, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "LatexToPdfError";
    this.code = code;
    if (log !== undefined) this.log = log;
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    const out = { code: this.code, message: this.message };
    if (this.log !== undefined) out.log = this.log;
    return out;
  }
}

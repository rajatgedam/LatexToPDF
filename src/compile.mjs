import { readFile, stat, lstat, writeFile, rename, rm, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { LatexToPdfError } from "./errors.mjs";
import { normalizeInput } from "./input.mjs";
import { assertSafe } from "./validate.mjs";
import { applyCompat } from "./compat.mjs";
import { runEngine } from "./engine.mjs";
import { createLimiter } from "./limiter.mjs";
import { countPages } from "./pdf.mjs";

const MAX_WARNINGS = 20;
const extractWarnings = (log) => (log.match(/^warning:.*$/gm) ?? []).slice(0, MAX_WARNINGS);
const invalidOutput = (msg) => new LatexToPdfError("OUTPUT_PATH_INVALID", msg);
const invalidInput = (msg) => new LatexToPdfError("INPUT_INVALID", msg);

async function readInputFile(file, maxBytes) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw invalidInput("input must be an existing regular file");
  if (info.size > maxBytes) throw new LatexToPdfError("INPUT_TOO_LARGE", `Input exceeds ${maxBytes} bytes`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await readFile(file));
  } catch {
    throw invalidInput("input is not valid UTF-8");
  }
}

async function prepareOutput(output, mkdirParents) {
  if (typeof output !== "string" || output.trim() === "") throw invalidOutput("output path is required");
  if (!/\.pdf$/i.test(output)) throw invalidOutput("output path must end with .pdf");
  const target = path.resolve(output);
  const existing = await lstat(target).catch(() => null);
  if (existing && !existing.isFile()) throw invalidOutput("output must be a regular file path (no symlinks or directories)");
  const parent = path.dirname(target);
  if (mkdirParents) await mkdir(parent, { recursive: true });
  else if (!(await stat(parent).catch(() => null))?.isDirectory()) throw invalidOutput("output directory does not exist (use mkdir to create it)");
  return target;
}

async function writeAtomic(target, data) {
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, data, { flag: "wx", mode: 0o644 });
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Factory so each consumer (CLI, server, tests) owns its own concurrency limiter. */
export function createCompiler(config = loadConfig()) {
  const limiter = createLimiter(config.maxConcurrency);

  async function compile({ source, mode = "auto", timeoutMs = config.timeoutMs, signal } = {}) {
    const { tex: normalized, kind } = normalizeInput(source, { mode, maxBytes: config.maxInputBytes });
    const { tex, notes } = applyCompat(normalized);
    assertSafe(tex);
    const release = limiter.tryAcquire();
    if (!release) throw new LatexToPdfError("BUSY", "Too many compilations in progress; retry shortly");
    const started = performance.now();
    try {
      const { pdf, log } = await runEngine({ tex, config, timeoutMs, signal });
      return { pdf, kind, pages: countPages(pdf), warnings: [...notes, ...extractWarnings(log)], durationMs: Math.round(performance.now() - started) };
    } finally {
      release();
    }
  }

  async function compileToFile({ input, source, output, mode, mkdir: mkdirParents = false, timeoutMs } = {}) {
    if ((input === undefined) === (source === undefined)) throw invalidInput("provide exactly one of input (file path) or source (string)");
    const target = await prepareOutput(output, mkdirParents);
    const text = input !== undefined ? await readInputFile(path.resolve(String(input)), config.maxInputBytes) : source;
    const result = await compile({ source: text, mode, timeoutMs });
    await writeAtomic(target, result.pdf);
    return { outputPath: target, bytes: result.pdf.length, pages: result.pages, durationMs: result.durationMs, warnings: result.warnings, kind: result.kind };
  }

  return { compile, compileToFile, config };
}

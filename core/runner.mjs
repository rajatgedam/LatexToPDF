import { readFile, stat, lstat, writeFile, rename, rm, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { ToolMasterError } from "./errors.mjs";
import { createLimiter } from "./limiter.mjs";
import { resolveEngine, engineInfo } from "./engines.mjs";
import { runProcess } from "./process.mjs";

const invalid = (code, msg) => new ToolMasterError(code, msg);
const STATUS_TTL_MS = 30_000;

function coerceBoolean(def, v) {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  throw invalid("INPUT_INVALID", `Option "${def.id}" must be true or false`);
}

/** Validate caller options against the manifest; unknown keys and bad values are rejected, defaults filled in. */
export function resolveOptions(manifest, given = {}) {
  const defs = manifest.options ?? [];
  if (given === null || typeof given !== "object" || Array.isArray(given)) throw invalid("INPUT_INVALID", "options must be an object");
  for (const key of Object.keys(given)) if (!defs.some((d) => d.id === key)) throw invalid("INPUT_INVALID", `Unknown option "${key}" for ${manifest.id}`);
  const out = {};
  for (const def of defs) {
    const v = given[def.id] ?? def.default;
    if (def.type === "boolean") out[def.id] = coerceBoolean(def, v);
    else if (def.values.includes(String(v))) out[def.id] = String(v);
    else throw invalid("INPUT_INVALID", `Option "${def.id}" must be one of: ${def.values.join(", ")}`);
  }
  return out;
}

function validateInput(manifest, input, maxBytes) {
  if (manifest.input.kind === "text") {
    if (typeof input !== "string") throw invalid("INPUT_INVALID", "input must be a string");
    if (Buffer.byteLength(input, "utf8") > maxBytes) throw invalid("INPUT_TOO_LARGE", `Input exceeds ${maxBytes} bytes`);
    if (input.includes("\0")) throw invalid("INPUT_INVALID", "Input contains NUL bytes");
    if (input.trim() === "") throw invalid("INPUT_EMPTY", "Input is empty");
    return input;
  }
  if (!(input instanceof Uint8Array)) throw invalid("INPUT_INVALID", "input must be binary data");
  if (input.length === 0) throw invalid("INPUT_EMPTY", "Input is empty");
  if (input.length > maxBytes) throw invalid("INPUT_TOO_LARGE", `Input exceeds ${maxBytes} bytes`);
  return Buffer.from(input);
}

export const inputLimit = (manifest, config) => manifest.input.maxBytes ?? config.maxInputBytes;

async function readInputFile(file, manifest, maxBytes) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw invalid("INPUT_INVALID", "input must be an existing regular file");
  if (info.size > maxBytes) throw invalid("INPUT_TOO_LARGE", `Input exceeds ${maxBytes} bytes`);
  const bytes = await readFile(file);
  if (manifest.input.kind === "binary") return bytes;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalid("INPUT_INVALID", "input is not valid UTF-8");
  }
}

async function prepareOutput(output, extension, mkdirParents) {
  const bad = (msg) => invalid("OUTPUT_PATH_INVALID", msg);
  if (typeof output !== "string" || output.trim() === "") throw bad("output path is required");
  if (!output.toLowerCase().endsWith(`.${extension}`)) throw bad(`output path must end with .${extension}`);
  const target = path.resolve(output);
  const existing = await lstat(target).catch(() => null);
  if (existing && !existing.isFile()) throw bad("output must be a regular file path (no symlinks or directories)");
  const parent = path.dirname(target);
  if (mkdirParents) await mkdir(parent, { recursive: true });
  else if (!(await stat(parent).catch(() => null))?.isDirectory()) throw bad("output directory does not exist (use mkdir to create it)");
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

/** Runs tools with shared limits, validation and a concurrency cap. The only place that calls tool code. */
export function createRunner({ config, registry }) {
  const limiter = createLimiter(config.maxConcurrency);
  const statusCache = new Map();

  function contextFor(tool, { signal, timeoutMs }) {
    const specs = new Map((tool.manifest.engines ?? []).map((e) => [e.id, e]));
    const spec = (id) => {
      const s = specs.get(id);
      if (!s) throw invalid("TOOL_INVALID", `Tool "${tool.manifest.id}" did not declare engine "${id}"`);
      return s;
    };
    return {
      config,
      signal,
      timeoutMs,
      limits: { maxInputBytes: inputLimit(tool.manifest, config), maxOutputBytes: config.maxOutputBytes },
      engine: async (id) => resolveEngine(config, spec(id)),
      exec: async ({ engine, ...opts }) => runProcess({ command: await resolveEngine(config, spec(engine)), config, signal, timeoutMs, ...opts }),
      cacheDir: (name) => path.join(config.cacheRoot, name),
    };
  }

  async function invoke(kind, toolId, { input, options, signal, timeoutMs = config.timeoutMs } = {}) {
    const tool = registry.get(toolId);
    const { manifest } = tool;
    if (kind === "preview" && manifest.preview !== "html") throw invalid("INPUT_INVALID", `Tool "${toolId}" has no html preview`);
    const resolved = resolveOptions(manifest, options);
    const valid = validateInput(manifest, input, inputLimit(manifest, config));
    const release = limiter.tryAcquire();
    if (!release) throw invalid("BUSY", "Too many jobs in progress; retry shortly");
    const started = performance.now();
    try {
      const result = await tool[kind](contextFor(tool, { signal, timeoutMs }), { input: valid, options: resolved });
      if (!(result?.data instanceof Uint8Array)) throw invalid("TOOL_FAILED", `Tool "${toolId}" returned no data`);
      if (result.data.length > config.maxOutputBytes) throw invalid("OUTPUT_TOO_LARGE", `Output exceeds ${config.maxOutputBytes} bytes`);
      return {
        toolId,
        data: Buffer.from(result.data),
        contentType: result.contentType ?? manifest.output.contentType,
        extension: manifest.output.extension,
        meta: result.meta ?? {},
        warnings: result.warnings ?? [],
        durationMs: Math.round(performance.now() - started),
      };
    } finally {
      release();
    }
  }

  async function runToFile({ tool: toolId, input, source, output, options, mkdir: mkdirParents = false, timeoutMs } = {}) {
    if ((input === undefined) === (source === undefined)) throw invalid("INPUT_INVALID", "provide exactly one of input (file path) or source (data)");
    const { manifest } = registry.get(toolId);
    const target = await prepareOutput(output, manifest.output.extension, mkdirParents);
    const data = input !== undefined ? await readInputFile(path.resolve(String(input)), manifest, inputLimit(manifest, config)) : source;
    const r = await invoke("run", toolId, { input: data, options, timeoutMs });
    await writeAtomic(target, r.data);
    return { toolId, outputPath: target, bytes: r.data.length, meta: r.meta, warnings: r.warnings, durationMs: r.durationMs };
  }

  /** Engine availability per tool; cached briefly because it spawns processes. */
  async function status({ fresh = false } = {}) {
    const out = {};
    for (const tool of registry.list()) {
      const id = tool.manifest.id;
      const cached = statusCache.get(id);
      if (!fresh && cached && Date.now() - cached.at < STATUS_TTL_MS) {
        out[id] = cached.value;
        continue;
      }
      const engines = await Promise.all((tool.manifest.engines ?? []).map((spec) => engineInfo(config, spec)));
      const value = { ready: engines.every((e) => e.found), engines: engines.map(({ path: _omit, ...e }) => e) };
      statusCache.set(id, { at: Date.now(), value });
      out[id] = value;
    }
    return out;
  }

  return {
    config,
    registry,
    run: (toolId, request) => invoke("run", toolId, request),
    preview: (toolId, request) => invoke("preview", toolId, request),
    runToFile,
    status,
    /** Let a tool prime its caches (e.g. download packages). Returns false if it has nothing to warm. */
    async warmup(toolId) {
      const tool = registry.get(toolId);
      if (typeof tool.warmup !== "function") return false;
      await tool.warmup(contextFor(tool, { timeoutMs: 300_000 }));
      return true;
    },
  };
}

import { parseArgs } from "node:util";
import { loadConfig } from "./config.mjs";
import { createCompiler } from "./compile.mjs";
import { LatexToPdfError } from "./errors.mjs";
import { MODES } from "./input.mjs";
import { engineInfo } from "./engine.mjs";

const EXIT = {
  INPUT_EMPTY: 2, INPUT_TOO_LARGE: 2, INPUT_INVALID: 2, OUTPUT_PATH_INVALID: 2, CONFIG_INVALID: 2,
  POLICY_VIOLATION: 3, COMPILE_FAILED: 4, OUTPUT_TOO_LARGE: 4, TIMEOUT: 5, ENGINE_NOT_FOUND: 6, BUSY: 7,
};
export const exitCodeFor = (code) => EXIT[code] ?? 1;

const USAGE = `latex2pdf - convert LaTeX (or plain text) to PDF locally

Usage:
  latex2pdf -i <file.tex|file.txt|-> -o <out.pdf> [options]
  latex2pdf --check

Options:
  -i, --input <path|->   Source file, or "-" for stdin
  -o, --output <path>    Output PDF path (must end in .pdf; overwritten if present)
  -m, --mode <mode>      auto (default) | latex | fragment | text
      --mkdir            Create missing parent directories of --output
      --timeout <ms>     Compile timeout (default 60000)
      --json             Print one JSON object on stdout instead of text
      --check            Verify the engine is installed and exit
  -h, --help             Show this help

Exit codes:
  0 ok | 1 unexpected | 2 bad usage/input | 3 policy violation | 4 compile failed
  5 timeout | 6 engine missing | 7 busy
`;

async function readStdin(stream, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw new LatexToPdfError("INPUT_TOO_LARGE", `Input exceeds ${maxBytes} bytes`);
    chunks.push(buf);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new LatexToPdfError("INPUT_INVALID", "stdin is not valid UTF-8");
  }
}

function parse(argv) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      input: { type: "string", short: "i" },
      output: { type: "string", short: "o" },
      mode: { type: "string", short: "m" },
      timeout: { type: "string" },
      mkdir: { type: "boolean" },
      json: { type: "boolean" },
      check: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.mode !== undefined && !MODES.includes(values.mode)) throw new LatexToPdfError("INPUT_INVALID", `--mode must be one of: ${MODES.join(", ")}`);
  if (values.timeout !== undefined && !/^[1-9]\d{0,8}$/.test(values.timeout)) throw new LatexToPdfError("INPUT_INVALID", "--timeout must be a positive integer (ms)");
  return values;
}

/** Testable CLI entry. Returns the process exit code. */
export async function runCli(argv, { env = process.env, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, projectRoot } = {}) {
  let json = argv.includes("--json");
  const emit = (obj, text) => stdout.write(json ? `${JSON.stringify(obj)}\n` : `${text}\n`);
  const fail = (err) => {
    const e = err instanceof LatexToPdfError ? err : new LatexToPdfError("UNEXPECTED", "Unexpected internal error");
    if (json) stdout.write(`${JSON.stringify({ ok: false, error: e.toJSON() })}\n`);
    else stderr.write(`error [${e.code}]: ${e.message}\n${e.log ? `${e.log}\n` : ""}`);
    return exitCodeFor(e.code);
  };

  try {
    let args;
    try {
      args = parse(argv);
    } catch (err) {
      if (err instanceof LatexToPdfError) throw err;
      stderr.write(`${err.message}\n\n${USAGE}`);
      return 2;
    }
    json = Boolean(args.json);
    if (args.help) {
      stdout.write(USAGE);
      return 0;
    }
    const config = loadConfig(env, projectRoot ? { projectRoot } : {});
    if (args.check) {
      const { path: _omit, ...engine } = await engineInfo(config);
      emit({ ok: engine.found, engine }, engine.found ? `engine ok: ${engine.version}` : "engine not found");
      return engine.found ? 0 : 6;
    }
    if (!args.input || !args.output) {
      stderr.write(`--input and --output are required\n\n${USAGE}`);
      return 2;
    }
    const compiler = createCompiler(config);
    const common = { output: args.output, mode: args.mode, mkdir: args.mkdir, timeoutMs: args.timeout ? Number(args.timeout) : undefined };
    const r = args.input === "-"
      ? await compiler.compileToFile({ ...common, source: await readStdin(stdin, config.maxInputBytes) })
      : await compiler.compileToFile({ ...common, input: args.input });
    emit(
      { ok: true, outputPath: r.outputPath, bytes: r.bytes, pages: r.pages, durationMs: r.durationMs, warnings: r.warnings },
      `OK ${r.outputPath} (${r.pages} page(s), ${r.bytes} bytes, ${r.durationMs} ms)`,
    );
    return 0;
  } catch (err) {
    return fail(err);
  }
}

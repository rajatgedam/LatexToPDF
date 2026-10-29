import { parseArgs } from "node:util";
import { createToolMaster } from "../index.mjs";
import { ToolMasterError } from "../errors.mjs";
import { installEngine } from "../installer.mjs";
import { launchUi } from "../server/launch.mjs";
import { runMenu } from "./menu.mjs";
import { runMcp } from "../mcp.mjs";

const EXIT = {
  INPUT_EMPTY: 2, INPUT_TOO_LARGE: 2, INPUT_INVALID: 2, OUTPUT_PATH_INVALID: 2, CONFIG_INVALID: 2, TOOL_NOT_FOUND: 2,
  POLICY_VIOLATION: 3, TOOL_FAILED: 4, OUTPUT_TOO_LARGE: 4, TIMEOUT: 5, ENGINE_NOT_FOUND: 6, BUSY: 7,
};
export const exitCodeFor = (code) => EXIT[code] ?? 1;

const isTextType = (contentType) => /^text\/|json|xml/.test(contentType);

const HELP = `ToolMaster: small local tools, one menu. Nothing leaves your machine.

Usage:
  toolmaster                         interactive menu (when run in a terminal)
  toolmaster ui [--no-open]          open the web app
  toolmaster list [--json]           show the tools in this build and whether they are ready
  toolmaster run <tool> -i <in|-> -o <out|-> [-O key=value ...] [--mkdir] [--timeout ms] [--json]
  toolmaster <tool> ...              same as run <tool> ...
  toolmaster help <tool> [--json]    options and examples for one tool
  toolmaster sample <tool>           print a known-good example input
  toolmaster mcp                     serve every tool to AI agents over MCP (stdio)
  toolmaster install [tool ...]      download the pinned engines (SHA-256 verified)
  toolmaster doctor [--json]         check that every tool's engine works
  toolmaster warmup [tool ...]       pre-download packages so tools also work offline

-o - prints a text result (for example Markdown) to stdout instead of writing a file.

Exit codes:
  0 ok | 1 unexpected | 2 bad usage/input/output path/unknown tool | 3 policy violation
  4 tool failed (read the log) | 5 timeout | 6 engine missing | 7 busy
`;

async function readStdin(stream, maxBytes, kind) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw new ToolMasterError("INPUT_TOO_LARGE", `Input exceeds ${maxBytes} bytes`);
    chunks.push(buf);
  }
  const all = Buffer.concat(chunks);
  if (kind === "binary") return all;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(all);
  } catch {
    throw new ToolMasterError("INPUT_INVALID", "stdin is not valid UTF-8");
  }
}

function parseOptions(pairs = []) {
  const out = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    if (!key) throw new ToolMasterError("INPUT_INVALID", "-O expects key=value");
    out[key] = eq < 0 ? "true" : pair.slice(eq + 1);
  }
  return out;
}

function parseRunArgs(args) {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      input: { type: "string", short: "i" },
      output: { type: "string", short: "o" },
      option: { type: "string", short: "O", multiple: true },
      timeout: { type: "string" },
      mkdir: { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  if (values.timeout !== undefined && !/^[1-9]\d{0,8}$/.test(values.timeout)) throw new ToolMasterError("INPUT_INVALID", "--timeout must be a positive integer (ms)");
  return values;
}

function toolHelp(m) {
  const hint = (o) => (o.type === "enum" ? o.values.join("|") : o.type === "boolean" ? "true|false" : "text");
  const opts = (m.options ?? []).map((o) => `  -O ${o.id}=${hint(o)}   ${o.label}${o.help ? `. ${o.help}` : ""} (default ${JSON.stringify(o.default)})`);
  return [
    `${m.name} (${m.id}): ${m.description}`,
    ...(m.useWhen ? [`  use when: ${m.useWhen}`] : []),
    `  input : ${m.input.kind === "text" ? "text" : "file"} (${m.input.accept.join(", ")})`,
    `  output: .${m.output.extension} (${m.output.contentType})`,
    ...(opts.length ? ["Options:", ...opts] : []),
    "Example:",
    `  toolmaster ${m.id} -i input${m.input.accept[0]} -o ${isTextType(m.output.contentType) ? "-" : `output.${m.output.extension}`} --json`,
    "",
  ].join("\n");
}

const pickTools = (tm, names) => (names.length ? names.map((n) => tm.registry.get(n)) : tm.registry.list());

/** Public, JSON-friendly view of a manifest: engine ids only, no inline sample. */
const describe = (tm, { sample: _omit, engines: declared, ...m }) => ({ ...m, engines: tm.engines.forManifest({ engines: declared }).map((e) => e.id) });

/**
 * Testable CLI entry. Returns an exit code, or `{ ui }` when a long-running web server was started.
 * `deps` lets tests replace the pieces that touch the network or start servers.
 */
export async function runCli(argv, io = {}) {
  const {
    env = process.env, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, projectRoot, tools, engines, self,
    deps = {}, interactive = Boolean(stdin.isTTY && stdout.isTTY),
  } = io;
  const d = { launchUi, installEngine, ...deps };
  const json = argv.includes("--json");
  const emit = (obj, text) => stdout.write(json ? `${JSON.stringify(obj)}\n` : `${text}\n`);
  const fail = (err) => {
    const e = err instanceof ToolMasterError ? err : new ToolMasterError("UNEXPECTED", "Unexpected internal error");
    if (json) stdout.write(`${JSON.stringify({ ok: false, error: e.toJSON() })}\n`);
    else stderr.write(`error [${e.code}]: ${e.message}\n${e.log ? `${e.log}\n` : ""}`);
    return exitCodeFor(e.code);
  };
  const usage = (msg) => {
    stderr.write(`${msg}\n\n${HELP}`);
    return 2;
  };

  try {
    const [first, ...rest] = argv;
    if (first === "-h" || first === "--help" || (first === "help" && rest.length === 0)) {
      stdout.write(HELP);
      return 0;
    }
    const tm = io.tm ?? (await createToolMaster({ env, projectRoot, tools, engines, self }));

    if (!first) {
      if (!interactive) {
        stdout.write(HELP);
        return 0;
      }
      return await runMenu({ tm, stdin, stdout, deps: d });
    }

    switch (first) {
      case "help": {
        const m = tm.registry.get(rest[0]).manifest;
        if (json) emit({ ok: true, tool: describe(tm, m) });
        else stdout.write(toolHelp(m));
        return 0;
      }

      case "list": {
        const status = await tm.runner.status({ fresh: true });
        const rows = tm.registry.list().map(({ manifest: m }) => ({ ...describe(tm, m), status: status[m.id] }));
        emit({ ok: true, tools: rows }, rows.map((m) => `${m.id.padEnd(16)} ${m.name.padEnd(16)} ${m.status.ready ? "ready" : "engine missing"}   ${m.description}`).join("\n"));
        return 0;
      }

      case "sample": {
        const m = tm.registry.get(rest[0]).manifest;
        if (!m.sample) throw new ToolMasterError("INPUT_INVALID", `Tool "${m.id}" has no sample`);
        stdout.write(m.sample.endsWith("\n") ? m.sample : `${m.sample}\n`);
        return 0;
      }

      case "doctor": {
        const status = await tm.runner.status({ fresh: true });
        const ok = Object.values(status).every((s) => s.ready);
        emit(
          { ok, tools: status },
          Object.entries(status).map(([id, s]) => `${id}: ${s.ready ? "ready" : "engine missing"} ${s.engines.map((e) => (e.found ? `(${e.version})` : `(${e.id} not installed)`)).join(" ")}`).join("\n"),
        );
        return ok ? 0 : 6;
      }

      case "install": {
        const force = rest.includes("--force");
        const specs = tm.engines.forManifests(pickTools(tm, rest.filter((a) => !a.startsWith("--"))).map((t) => t.manifest));
        for (const spec of specs) await d.installEngine({ config: tm.config, spec, force, log: (m) => stdout.write(`${m}\n`) });
        if (specs.length === 0) stdout.write("Nothing to install.\n");
        return 0;
      }

      case "warmup": {
        for (const t of pickTools(tm, rest)) {
          const did = await tm.runner.warmup(t.manifest.id);
          stdout.write(did ? `${t.manifest.id}: cache primed\n` : `${t.manifest.id}: nothing to warm\n`);
        }
        return 0;
      }

      case "ui": {
        if (rest.some((a) => a !== "--no-open")) return usage("ui only accepts --no-open");
        return { ui: await d.launchUi({ tm, open: !rest.includes("--no-open") }) };
      }

      case "mcp":
        return await runMcp({ tm, stdin, stdout, stderr, env });

      default: {
        const toolId = first === "run" ? rest[0] : first;
        const args = first === "run" ? rest.slice(1) : rest;
        if (!toolId || toolId.startsWith("-")) return usage("Usage: toolmaster run <tool> -i <in> -o <out>");
        if (!tm.registry.has(toolId)) return usage(`Unknown command or tool "${toolId}".`);
        let a;
        try {
          a = parseRunArgs(args);
        } catch (err) {
          if (err instanceof ToolMasterError) throw err;
          return usage(err.message);
        }
        if (!a.input || !a.output) return usage("--input and --output are required");
        const m = tm.registry.get(toolId).manifest;
        const common = { tool: toolId, options: parseOptions(a.option), timeoutMs: a.timeout ? Number(a.timeout) : undefined };
        const src = a.input === "-" ? { source: await readStdin(stdin, tm.config.maxInputBytes, m.input.kind) } : { input: a.input };
        if (a.output === "-") {
          if (!isTextType(m.output.contentType)) throw new ToolMasterError("OUTPUT_PATH_INVALID", `-o - prints text only; ${m.id} produces ${m.output.contentType}, so give a file path`);
          const r = await tm.runner.runFromSource({ ...common, ...src });
          const text = r.data.toString("utf8");
          if (json) stdout.write(`${JSON.stringify({ ok: true, tool: toolId, content: text, bytes: r.data.length, meta: r.meta, durationMs: r.durationMs, warnings: r.warnings })}\n`);
          else stdout.write(text.endsWith("\n") ? text : `${text}\n`);
          return 0;
        }
        const r = await tm.runner.runToFile({ ...common, ...src, output: a.output, mkdir: a.mkdir });
        const pages = r.meta?.pages ? `${r.meta.pages} page(s), ` : "";
        emit({ ok: true, tool: toolId, outputPath: r.outputPath, bytes: r.bytes, meta: r.meta, durationMs: r.durationMs, warnings: r.warnings }, `OK ${r.outputPath} (${pages}${r.bytes} bytes, ${r.durationMs} ms)`);
        return 0;
      }
    }
  } catch (err) {
    return fail(err);
  }
}

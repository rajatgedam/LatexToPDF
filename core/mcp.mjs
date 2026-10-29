import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { ToolMasterError } from "./errors.mjs";
import { VERSION } from "./version.mjs";

// Model Context Protocol over stdio: newline-delimited JSON-RPC 2.0 (https://modelcontextprotocol.io). Every tool in the
// registry becomes one MCP tool, generated from its manifest, so agents get new tools without any extra code.
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INLINE_MAX_CHARS = 200_000;
const RPC = { PARSE: -32700, REQUEST: -32600, METHOD: -32601, PARAMS: -32602, INTERNAL: -32603 };
const isTextType = (contentType) => /^text\/|json|xml/.test(contentType);

const INSTRUCTIONS = [
  "ToolMaster runs small, deterministic local tools (document conversion, PDF page work, text extraction).",
  "Prefer these tools over writing a one-off script: they are tested, sandboxed and need no extra installs.",
  "Pass input_path (a file) or input_text; pass output_path to write a file. Text results come back inline when output_path is omitted.",
  "Files must be inside the working folder or the temp folder (set TOOLMASTER_MCP_ROOTS to allow more).",
].join(" ");

/** Folders MCP callers may read from and write to: TOOLMASTER_MCP_ROOTS (path-delimited), else the working folder and the temp folder. */
export async function allowedRoots(env = process.env, cwd = process.cwd()) {
  const raw = env.TOOLMASTER_MCP_ROOTS ? env.TOOLMASTER_MCP_ROOTS.split(path.delimiter).filter(Boolean) : [cwd, os.tmpdir()];
  return Promise.all(raw.map((r) => realpath(path.resolve(r)).catch(() => path.resolve(r))));
}

/** Real path of `p`, or of its nearest existing ancestor plus the missing tail (so symlinks cannot smuggle a path out of a root). */
async function realOrAncestor(p) {
  let current = path.resolve(p);
  const tail = [];
  for (;;) {
    try {
      return path.join(await realpath(current), ...tail.reverse());
    } catch (err) {
      const parent = path.dirname(current);
      if (parent === current) throw err;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

export async function confine(p, roots, what) {
  if (typeof p !== "string" || p.trim() === "" || p.includes("\0")) throw new ToolMasterError("INPUT_INVALID", `${what} must be a non-empty path`);
  const real = await realOrAncestor(p);
  if (!roots.some((r) => real === r || real.startsWith(r + path.sep))) {
    throw new ToolMasterError("INPUT_INVALID", `${what} is outside the folders this server may use. Allowed: ${roots.join(", ")} (TOOLMASTER_MCP_ROOTS changes this)`);
  }
  return real;
}

const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);
const typeOf = (o) => (o.type === "boolean" ? { type: "boolean" } : o.type === "enum" ? { type: "string", enum: o.values } : { type: "string", maxLength: o.maxLength ?? 200 });

/** MCP tool definition for one manifest. */
export function toMcpTool(manifest) {
  const m = manifest;
  const text = m.input.kind === "text";
  const properties = {
    input_path: { type: "string", description: `Path of the input file (${m.input.accept.join(", ")}).` },
    ...(text ? { input_text: { type: "string", description: "The input content itself, instead of input_path." } } : {}),
    output_path: {
      type: "string",
      description: `Where to write the .${m.output.extension} result.${isTextType(m.output.contentType) ? " Optional: the text comes back inline when omitted." : " Optional: a temp file is used when omitted."}`,
    },
  };
  for (const o of m.options ?? []) properties[o.id] = { ...typeOf(o), default: o.default, description: `${o.label}.${o.help ? ` ${o.help}` : ""}` };
  return {
    name: m.id,
    title: m.name,
    description: [m.description, m.useWhen, `Output: .${m.output.extension}.`].filter(Boolean).map(sentence).join(" "),
    inputSchema: { type: "object", properties, ...(text ? {} : { required: ["input_path"] }), additionalProperties: false },
    annotations: { title: m.name, readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };
}

const summary = (r, extra = {}) => ({ ok: true, tool: r.toolId, bytes: r.data.length, meta: r.meta, warnings: r.warnings, durationMs: r.durationMs, ...extra });

/** Run one `tools/call`. Returns MCP tool result content; tool failures come back as `isError`, not as protocol errors. */
async function callTool({ tm, roots, name, args, signal }) {
  if (!tm.registry.has(name)) throw Object.assign(new Error(`Unknown tool "${name}"`), { rpc: RPC.PARAMS });
  const { manifest } = tm.registry.get(name);
  const { input_path: inputPath, input_text: inputText, output_path: outputPath, ...options } = args ?? {};
  try {
    if ((inputPath === undefined) === (inputText === undefined)) throw new ToolMasterError("INPUT_INVALID", "Provide exactly one of input_path or input_text");
    if (inputText !== undefined && manifest.input.kind !== "text") throw new ToolMasterError("INPUT_INVALID", `${name} needs a file: use input_path`);
    const source = inputPath !== undefined ? { input: await confine(inputPath, roots, "input_path") } : { source: inputText };
    const base = { tool: name, options, signal, ...source };

    if (outputPath === undefined && isTextType(manifest.output.contentType)) {
      const r = await tm.runner.runFromSource(base);
      const text = r.data.toString("utf8");
      const truncated = text.length > INLINE_MAX_CHARS;
      const head = summary(r, { truncated, note: truncated ? "Output truncated; pass output_path to get the whole file." : undefined });
      return { content: [{ type: "text", text: JSON.stringify(head) }, { type: "text", text: truncated ? text.slice(0, INLINE_MAX_CHARS) : text }], structuredContent: head, isError: false };
    }

    const target = outputPath !== undefined
      ? await confine(outputPath, roots, "output_path")
      : path.join(await mkdtemp(path.join(await ensureTempDir(), `${name}-`)), `output.${manifest.output.extension}`);
    const r = await tm.runner.runToFile({ ...base, output: target, mkdir: true });
    const out = { ok: true, tool: name, outputPath: r.outputPath, bytes: r.bytes, meta: r.meta, warnings: r.warnings, durationMs: r.durationMs };
    return { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out, isError: false };
  } catch (err) {
    const e = err instanceof ToolMasterError ? err : new ToolMasterError("UNEXPECTED", "Unexpected internal error");
    const body = { ok: false, error: e.toJSON() };
    return { content: [{ type: "text", text: `error [${e.code}]: ${e.message}${e.log ? `\n${e.log.split("\n").slice(-12).join("\n")}` : ""}` }], structuredContent: body, isError: true };
  }
}

async function ensureTempDir() {
  const dir = path.join(os.tmpdir(), "toolmaster-mcp");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Serve MCP on the given streams until stdin ends. Returns 0. */
export async function runMcp({ tm, stdin, stdout, stderr, env = process.env }) {
  const roots = await allowedRoots(env);
  const running = new Map();
  const pending = new Set();
  const send = (msg) => stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
  const fail = (id, code, message) => send({ id, error: { code, message } });

  async function handle(msg) {
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;
    if (method === "notifications/cancelled") {
      running.get(params?.requestId)?.abort();
      return;
    }
    if (!isRequest) return; // other notifications (initialized, progress) need no reply
    switch (method) {
      case "initialize": {
        const asked = params?.protocolVersion;
        return send({ id, result: { protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "toolmaster", title: "ToolMaster", version: VERSION }, instructions: INSTRUCTIONS } });
      }
      case "ping":
        return send({ id, result: {} });
      case "tools/list":
        return send({ id, result: { tools: tm.registry.list().map((t) => toMcpTool(t.manifest)) } });
      case "tools/call": {
        if (typeof params?.name !== "string") return fail(id, RPC.PARAMS, "tools/call needs a tool name");
        const ac = new AbortController();
        running.set(id, ac);
        try {
          return send({ id, result: await callTool({ tm, roots, name: params.name, args: params.arguments, signal: ac.signal }) });
        } catch (err) {
          return fail(id, err.rpc ?? RPC.INTERNAL, err.rpc ? err.message : "Internal error");
        } finally {
          running.delete(id);
        }
      }
      default:
        return fail(id, RPC.METHOD, `Method not found: ${method}`);
    }
  }

  const rl = createInterface({ input: stdin, terminal: false });
  for await (const line of rl) {
    if (line.trim() === "") continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(null, RPC.PARSE, "Parse error");
      continue;
    }
    if (msg === null || typeof msg !== "object" || Array.isArray(msg) || typeof msg.method !== "string") {
      fail(msg?.id ?? null, RPC.REQUEST, "Invalid request");
      continue;
    }
    const job = handle(msg).catch((err) => {
      stderr.write(`[toolmaster mcp] ${err?.name ?? "Error"}\n`);
      if (msg.id !== undefined && msg.id !== null) fail(msg.id, RPC.INTERNAL, "Internal error");
    });
    pending.add(job);
    job.finally(() => pending.delete(job));
  }
  await Promise.all(pending);
  return 0;
}

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir, realpath } from "node:fs/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { createToolMaster } from "../../index.mjs";
import { runMcp, toMcpTool, confine, allowedRoots } from "../../mcp.mjs";
import { VERSION } from "../../version.mjs";
import { fakeTool } from "../../../test/helpers/fake-tool.mjs";

let dir;
let outside;
let tm;

const tools = () => [
  fakeTool({
    manifest: {
      id: "shout", name: "Shout", description: "Upper-cases text", useWhen: "You need louder text.",
      output: { contentType: "text/markdown; charset=utf-8", extension: "md" },
      options: [
        { id: "mode", label: "Mode", type: "enum", values: ["a", "b"], default: "a" },
        { id: "bang", label: "Bang", type: "boolean", default: false },
        { id: "pages", label: "Pages", type: "string", default: "all", maxLength: 40, help: "like 1-3" },
      ],
    },
    run: async (_c, { input, options }) => ({ data: Buffer.from(`${String(input).toUpperCase()}${options.bang ? "!" : ""}|${options.mode}|${options.pages}`), meta: { n: 1 }, warnings: ["w"] }),
  }),
  fakeTool({
    manifest: { id: "flip", name: "Flip", input: { kind: "binary", accept: [".bin"] }, output: { contentType: "application/octet-stream", extension: "bin" } },
    run: async (_c, { input }) => ({ data: Buffer.from(input).reverse() }),
  }),
  fakeTool({
    manifest: { id: "big", name: "Big", output: { contentType: "text/plain", extension: "txt" } },
    run: async () => ({ data: Buffer.from("x".repeat(250_000)) }),
  }),
  fakeTool({
    manifest: { id: "fails", name: "Fails", output: { contentType: "text/plain", extension: "txt" } },
    run: async () => { throw Object.assign(new (await import("../../sdk.mjs")).ToolMasterError("POLICY_VIOLATION", "not allowed", { log: "line1\nline2" })); },
  }),
];

before(async () => {
  dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "tm-mcp-")));
  outside = await realpath(await mkdtemp(path.join(os.tmpdir(), "tm-mcp-out-")));
  tm = await createToolMaster({ env: { TOOLMASTER_SANDBOX: "off" }, projectRoot: dir, tools: tools() });
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

/** Send raw lines to the server and collect every reply, keyed by id. */
async function talk(lines, env = { TOOLMASTER_MCP_ROOTS: dir }) {
  const out = [];
  const err = [];
  const code = await runMcp({
    tm,
    stdin: Readable.from(lines.map((l) => `${typeof l === "string" ? l : JSON.stringify(l)}\n`)),
    stdout: { write: (s) => out.push(JSON.parse(s)) },
    stderr: { write: (s) => err.push(s) },
    env,
  });
  return { code, replies: out, byId: Object.fromEntries(out.map((r) => [r.id, r])), err };
}
const call = (id, name, args) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

test("initialize negotiates a supported protocol version and describes the server", async () => {
  const { byId, code } = await talk([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 3, method: "ping" },
  ]);
  assert.equal(code, 0);
  assert.equal(byId[1].result.protocolVersion, "2025-03-26");
  assert.equal(byId[2].result.protocolVersion, "2025-06-18");
  assert.equal(byId[1].result.serverInfo.version, VERSION);
  assert.deepEqual(byId[1].result.capabilities, { tools: { listChanged: false } });
  assert.match(byId[1].result.instructions, /input_path/);
  assert.deepEqual(byId[3].result, {});
  assert.equal(Object.keys(byId).length, 3, "notifications get no reply");
});

test("tools/list turns each manifest into an MCP tool with a typed input schema", async () => {
  const { byId } = await talk([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);
  const list = byId[1].result.tools;
  assert.deepEqual(list.map((t) => t.name).sort(), ["big", "fails", "flip", "shout"]);
  const shout = list.find((t) => t.name === "shout");
  assert.match(shout.description, /Upper-cases text\. You need louder text\. Output: \.md\./);
  const p = shout.inputSchema.properties;
  assert.deepEqual(p.mode, { type: "string", enum: ["a", "b"], default: "a", description: "Mode." });
  assert.equal(p.bang.type, "boolean");
  assert.deepEqual([p.pages.type, p.pages.maxLength, p.pages.description], ["string", 40, "Pages. like 1-3"]);
  assert.ok(p.input_path && p.input_text && p.output_path);
  assert.equal(shout.inputSchema.additionalProperties, false);
  assert.equal(shout.inputSchema.required, undefined);
  const flip = list.find((t) => t.name === "flip");
  assert.deepEqual(flip.inputSchema.required, ["input_path"]);
  assert.equal(flip.inputSchema.properties.input_text, undefined);
  assert.equal(shout.annotations.readOnlyHint, false);
  assert.deepEqual(toMcpTool(tm.registry.get("flip").manifest), flip);
});

test("a text tool called with input_text and no output_path answers inline", async () => {
  const { byId } = await talk([call(1, "shout", { input_text: "hi", bang: true, mode: "b", pages: "2-3" })]);
  const r = byId[1].result;
  assert.equal(r.isError, false);
  assert.equal(r.content[1].text, "HI!|b|2-3");
  const head = JSON.parse(r.content[0].text);
  assert.deepEqual([head.ok, head.tool, head.bytes, head.meta, head.warnings], [true, "shout", 9, { n: 1 }, ["w"]]);
  assert.deepEqual(r.structuredContent, head);
});

test("files are read from and written to allowed folders only", async () => {
  await writeFile(path.join(dir, "in.txt"), "from file");
  await mkdir(path.join(dir, "sub"));
  const { byId } = await talk([
    call(1, "shout", { input_path: path.join(dir, "in.txt"), output_path: path.join(dir, "sub", "new", "out.md") }),
    call(2, "shout", { input_path: path.join(outside, "x.txt") }),
    call(3, "shout", { input_text: "x", output_path: path.join(outside, "y.md") }),
    call(4, "shout", { input_text: "x", output_path: "../escape.md" }),
  ]);
  assert.equal(byId[1].result.isError, false);
  const out = JSON.parse(byId[1].result.content[0].text);
  assert.equal(out.outputPath, path.join(dir, "sub", "new", "out.md"));
  assert.equal(await readFile(out.outputPath, "utf8"), "FROM FILE|a|all");
  for (const id of [2, 3, 4]) {
    assert.equal(byId[id].result.isError, true, `call ${id}`);
    assert.match(byId[id].result.content[0].text, /outside the folders|INPUT_INVALID/);
  }
});

test("a symlink inside an allowed folder cannot lead outside it", async () => {
  if (process.platform === "win32") return;
  await writeFile(path.join(outside, "secret.txt"), "secret");
  await symlink(outside, path.join(dir, "link"));
  const { byId } = await talk([call(1, "shout", { input_path: path.join(dir, "link", "secret.txt") }), call(2, "shout", { input_text: "x", output_path: path.join(dir, "link", "w.md") })]);
  assert.equal(byId[1].result.isError, true);
  assert.equal(byId[2].result.isError, true);
});

test("binary results go to a temp file when no output_path is given", async () => {
  await writeFile(path.join(dir, "b.bin"), Buffer.from([1, 2, 3]));
  const { byId } = await talk([call(1, "flip", { input_path: path.join(dir, "b.bin") })], { TOOLMASTER_MCP_ROOTS: [dir, os.tmpdir()].join(path.delimiter) });
  const out = JSON.parse(byId[1].result.content[0].text);
  assert.match(out.outputPath, /toolmaster-mcp[\\/]flip-[^\\/]+[\\/]output\.bin$/);
  assert.deepEqual([...(await readFile(out.outputPath))], [3, 2, 1]);
  await rm(path.dirname(out.outputPath), { recursive: true, force: true });
});

test("a tool that needs a file rejects input_text; exactly one input is required", async () => {
  const { byId } = await talk([call(1, "flip", { input_text: "x" }), call(2, "shout", {}), call(3, "shout", { input_text: "a", input_path: "b" })]);
  for (const id of [1, 2, 3]) assert.equal(byId[id].result.isError, true);
  assert.match(byId[1].result.content[0].text, /use input_path/);
  assert.match(byId[2].result.content[0].text, /exactly one/);
});

test("tool errors come back as isError results with the code and log tail", async () => {
  const { byId } = await talk([call(1, "fails", { input_text: "x" }), call(2, "shout", { input_text: "x", mode: "zzz" })]);
  assert.equal(byId[1].result.isError, true);
  assert.match(byId[1].result.content[0].text, /error \[POLICY_VIOLATION\]: not allowed\nline1\nline2/);
  assert.equal(byId[1].result.structuredContent.error.code, "POLICY_VIOLATION");
  assert.match(byId[2].result.content[0].text, /INPUT_INVALID/);
});

test("long inline text is truncated with a pointer to output_path", async () => {
  const { byId } = await talk([call(1, "big", { input_text: "x" })]);
  const r = byId[1].result;
  assert.equal(r.content[1].text.length, 200_000);
  const head = JSON.parse(r.content[0].text);
  assert.equal(head.truncated, true);
  assert.match(head.note, /output_path/);
});

test("protocol errors use JSON-RPC codes and never crash the server", async () => {
  const { replies, byId, code } = await talk([
    "{not json",
    "[]",
    JSON.stringify({ jsonrpc: "2.0", id: 5 }),
    { jsonrpc: "2.0", id: 6, method: "nope/nothing" },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: {} },
    call(8, "ghost", {}),
    "",
    { jsonrpc: "2.0", id: 9, method: "ping" },
  ]);
  assert.equal(code, 0);
  assert.equal(replies[0].error.code, -32700);
  assert.equal(replies[1].error.code, -32600);
  assert.equal(byId[5].error.code, -32600);
  assert.equal(byId[6].error.code, -32601);
  assert.equal(byId[7].error.code, -32602);
  assert.equal(byId[8].error.code, -32602);
  assert.deepEqual(byId[9].result, {});
});

test("cancelling a running call aborts it", async () => {
  const slow = fakeTool({ manifest: { id: "slow" }, run: (ctx) => new Promise((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(new (class extends Error { code = "TIMEOUT"; })("cancelled")))) });
  const local = await createToolMaster({ env: { TOOLMASTER_SANDBOX: "off" }, projectRoot: dir, tools: [slow] });
  const out = [];
  const input = new Readable({ read() {} });
  const done = runMcp({ tm: local, stdin: input, stdout: { write: (s) => out.push(JSON.parse(s)) }, stderr: { write() {} }, env: { TOOLMASTER_MCP_ROOTS: dir } });
  input.push(`${JSON.stringify(call(1, "slow", { input_text: "x" }))}\n`);
  await new Promise((r) => setTimeout(r, 50));
  input.push(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } })}\n`);
  input.push(null);
  await done;
  assert.equal(out.length, 1);
  assert.equal(out[0].result.isError, true);
});

test("allowed roots default to the working folder and temp folder, and TOOLMASTER_MCP_ROOTS replaces them", async () => {
  const defaults = await allowedRoots({}, dir);
  assert.deepEqual(defaults, [dir, await realpath(os.tmpdir())]);
  assert.deepEqual(await allowedRoots({ TOOLMASTER_MCP_ROOTS: [dir, outside].join(path.delimiter) }), [dir, outside]);
  await assert.rejects(confine("", [dir], "x"), { code: "INPUT_INVALID" });
  await assert.rejects(confine("a\0b", [dir], "x"), { code: "INPUT_INVALID" });
  assert.equal(await confine(path.join(dir, "not", "yet", "there.md"), [dir], "x"), path.join(dir, "not", "yet", "there.md"));
});

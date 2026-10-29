import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { runCli, exitCodeFor } from "../../cli/index.mjs";
import { createToolMaster } from "../../index.mjs";
import { ToolMasterError } from "../../sdk.mjs";
import { fakeTool, fakeEngineSpec } from "../../../test/helpers/fake-tool.mjs";

let dir;
let tm;
const OPTIONS = [
  { id: "shout", label: "Shout", type: "boolean", default: false },
  { id: "mode", label: "Mode", type: "enum", values: ["a", "b"], default: "a" },
];
const tools = () => [
  fakeTool({
    manifest: { options: OPTIONS, sample: "sample text", engines: [fakeEngineSpec({ id: "fake-engine", binary: "definitely-not-installed-xyz" })] },
    run: async (_c, { input, options }) => ({ data: Buffer.from(options.shout ? `${input}!` : input), meta: { pages: 2 }, warnings: ["careful"] }),
    warmup: async () => {},
  }),
  fakeTool({ manifest: { id: "plain-tool", name: "Plain", category: "zzz" } }),
  fakeTool({ manifest: { id: "policy-tool", name: "Policy", category: "zzz" }, run: async () => { throw new ToolMasterError("POLICY_VIOLATION", "nope"); } }),
];

async function cli(args, { stdin = "", interactive = false, deps = {} } = {}) {
  let out = "";
  let err = "";
  const code = await runCli(args, {
    tm,
    stdin: Readable.from([stdin]),
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
    interactive,
    deps,
  });
  return { code, out, err };
}

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tm-cli-"));
  tm = await createToolMaster({ env: { TOOLMASTER_SANDBOX: "off", TOOLMASTER_MAX_INPUT_BYTES: "1000" }, projectRoot: dir, tools: tools() });
});
after(() => rm(dir, { recursive: true, force: true }));

test("a tool id works as a shortcut command and prints a human summary", async () => {
  const input = path.join(dir, "a.txt");
  const output = path.join(dir, "a.out");
  await writeFile(input, "hello");
  const r = await cli(["fake-tool", "-i", input, "-o", output]);
  assert.equal(r.code, 0);
  assert.match(r.out, /OK .*a\.out \(2 page\(s\), 5 bytes/);
  assert.equal(await readFile(output, "utf8"), "hello");
});

test("`run <tool>` is equivalent; stdin and --json work; -O sets options", async () => {
  const output = path.join(dir, "b.out");
  const r = await cli(["run", "fake-tool", "-i", "-", "-o", output, "-O", "shout", "--json"], { stdin: "yo" });
  assert.equal(r.code, 0);
  const j = JSON.parse(r.out);
  assert.equal(j.ok, true);
  assert.equal(j.tool, "fake-tool");
  assert.equal(j.outputPath, output);
  assert.deepEqual(j.warnings, ["careful"]);
  assert.equal(await readFile(output, "utf8"), "yo!");
  assert.equal((await cli(["fake-tool", "-i", "-", "-o", output, "-O", "mode=b"], { stdin: "x" })).code, 0);
});

test("usage errors exit 2 and print usage", async () => {
  for (const args of [["fake-tool"], ["fake-tool", "-i", "x"], ["fake-tool", "--bogus"], ["nope", "-i", "a", "-o", "b.out"], ["run"], ["fake-tool", "-i", "x", "-o", "y.out", "--timeout", "abc"], ["fake-tool", "-i", "x", "-o", "y.out", "-O", "=v"]]) {
    assert.equal((await cli(args)).code, 2, args.join(" "));
  }
  assert.equal((await cli(["fake-tool", "-i", "-", "-o", path.join(dir, "z.out"), "-O", "mode=zzz"], { stdin: "x" })).code, 2);
  assert.equal((await cli(["ui", "--nope"])).code, 2);
});

test("help, tool help and exit-code docs", async () => {
  const h = await cli(["--help"]);
  assert.equal(h.code, 0);
  assert.match(h.out, /Exit codes/);
  const t = await cli(["help", "fake-tool"]);
  assert.equal(t.code, 0);
  assert.match(t.out, /-O mode=a\|b/);
  assert.match(t.out, /toolmaster fake-tool -i input\.txt -o - --json/);
  assert.equal((await cli(["help", "ghost"])).code, 2);
  assert.equal((await cli(["help"])).code, 0);
});

test("a policy violation exits 3 and tool errors carry their log", async () => {
  assert.equal((await cli(["policy-tool", "-i", "-", "-o", path.join(dir, "p.out")], { stdin: "x" })).code, 3);
  const j = JSON.parse((await cli(["policy-tool", "-i", "-", "-o", path.join(dir, "p.out"), "--json"], { stdin: "x" })).out);
  assert.equal(j.ok, false);
  assert.equal(j.error.code, "POLICY_VIOLATION");
});

test("list shows tools and readiness, as text and JSON", async () => {
  const text = await cli(["list"]);
  assert.match(text.out, /fake-tool\s+Fake Tool\s+engine missing/);
  assert.match(text.out, /plain-tool\s+Plain\s+ready/);
  const j = JSON.parse((await cli(["list", "--json"])).out);
  assert.equal(j.tools.length, 3);
  assert.equal(j.tools.find((t) => t.id === "plain-tool").status.ready, true);
  assert.equal("sample" in j.tools[0], false);
});

test("sample prints the tool's known-good input", async () => {
  assert.equal((await cli(["sample", "fake-tool"])).out, "sample text\n");
  assert.equal((await cli(["sample", "plain-tool"])).code, 2);
});

test("doctor exits 6 while an engine is missing", async () => {
  const r = await cli(["doctor"]);
  assert.equal(r.code, 6);
  assert.match(r.out, /fake-tool: engine missing/);
  assert.equal(JSON.parse((await cli(["doctor", "--json"])).out).ok, false);
});

test("install downloads each distinct engine once and honors --force and tool selection", async () => {
  const calls = [];
  const deps = { installEngine: async (o) => calls.push({ id: o.spec.id, force: o.force }) };
  assert.equal((await cli(["install"], { deps })).code, 0);
  assert.deepEqual(calls, [{ id: "fake-engine", force: false }]);
  calls.length = 0;
  await cli(["install", "fake-tool", "--force"], { deps });
  assert.deepEqual(calls, [{ id: "fake-engine", force: true }]);
  const none = await cli(["install", "plain-tool"], { deps });
  assert.match(none.out, /Nothing to install/);
  assert.equal((await cli(["install", "ghost"], { deps })).code, 2);
});

test("warmup primes tools that support it", async () => {
  const r = await cli(["warmup"]);
  assert.match(r.out, /fake-tool: cache primed/);
  assert.match(r.out, /plain-tool: nothing to warm/);
});

test("ui starts the web app via launchUi and returns it to the caller", async () => {
  const seen = [];
  const deps = { launchUi: async (o) => (seen.push(o.open), { url: "http://127.0.0.1:1" }) };
  const r = await runCli(["ui", "--no-open"], { tm, deps, stdout: { write() {} }, stderr: { write() {} }, stdin: Readable.from([]) });
  assert.deepEqual(r, { ui: { url: "http://127.0.0.1:1" } });
  await runCli(["ui"], { tm, deps, stdout: { write() {} }, stderr: { write() {} }, stdin: Readable.from([]) });
  assert.deepEqual(seen, [false, true]);
});

test("without arguments: help when not interactive", async () => {
  const r = await cli([]);
  assert.equal(r.code, 0);
  assert.match(r.out, /toolmaster ui/);
});

test("oversized stdin is rejected without buffering everything", async () => {
  assert.equal((await cli(["fake-tool", "-i", "-", "-o", path.join(dir, "g.out")], { stdin: "x".repeat(2000) })).code, 2);
});

test("exitCodeFor maps every documented error code", () => {
  const map = { INPUT_EMPTY: 2, INPUT_TOO_LARGE: 2, INPUT_INVALID: 2, OUTPUT_PATH_INVALID: 2, CONFIG_INVALID: 2, TOOL_NOT_FOUND: 2, POLICY_VIOLATION: 3, TOOL_FAILED: 4, OUTPUT_TOO_LARGE: 4, TIMEOUT: 5, ENGINE_NOT_FOUND: 6, BUSY: 7 };
  for (const [code, exit] of Object.entries(map)) assert.equal(exitCodeFor(code), exit, code);
  assert.equal(exitCodeFor("???"), 1);
});

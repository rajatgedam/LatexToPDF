import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createToolMaster } from "../../index.mjs";
import { runWorker } from "../../worker.mjs";
import { ToolMasterError } from "../../sdk.mjs";
import { fakeTool } from "../../../test/helpers/fake-tool.mjs";

let dir;
let self;

// A stand-in for "another copy of this program": answers the worker protocol based on the job name.
const WORKER = `
const fs = require("node:fs");
const [tool, job] = process.argv.slice(2);
const req = JSON.parse(fs.readFileSync("request.json", "utf8"));
const done = (body) => fs.writeFileSync("result.json", JSON.stringify(body));
if (job === "ok") { fs.writeFileSync("out.txt", "made by " + tool + " " + req.n + " " + fs.readFileSync("in.txt", "utf8")); done({ result: { n: req.n } }); }
else if (job === "soft") done({ error: { code: "INPUT_INVALID", message: "page 9 does not exist" } });
else if (job === "crash") { console.error("error: boom"); process.exit(3); }
else if (job === "silent") done({ result: {} });
else if (job === "env") done({ result: { options: process.env.NODE_OPTIONS, keys: Object.keys(process.env).sort() } });
`;

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tm-isolate-"));
  const script = path.join(dir, "worker.cjs");
  await writeFile(script, WORKER);
  self = { command: process.execPath, args: [script], ro: [] };
});
after(() => rm(dir, { recursive: true, force: true }));

const run = async (job, extra = {}) => {
  const tool = fakeTool({
    manifest: { id: "iso" },
    run: async (ctx) => {
      const r = await ctx.isolate({ job, request: { n: 7 }, files: { "in.txt": "payload" }, outputs: extra.outputs ?? [], ...extra.opts });
      return { data: Buffer.from(JSON.stringify(r)), meta: {} };
    },
  });
  const tm = await createToolMaster({ env: { TOOLMASTER_SANDBOX: "off" }, projectRoot: dir, tools: [tool], self });
  return JSON.parse((await tm.runner.run("iso", { input: "x" })).data.toString());
};

test("isolate runs the worker in a temp dir and returns its result and requested files", async () => {
  const r = await run("ok", { outputs: ["out.txt"] });
  assert.deepEqual(r.result, { n: 7 });
  assert.equal(Buffer.from(r.outputs["out.txt"].data).toString(), "made by iso 7 payload");
});

test("a handled failure keeps its error code and message", async () => {
  await assert.rejects(run("soft"), { code: "INPUT_INVALID", message: "page 9 does not exist" });
});

test("a crash becomes TOOL_FAILED with the worker's output as the log", async () => {
  await assert.rejects(run("crash"), (err) => err.code === "TOOL_FAILED" && /boom/.test(err.log) && err.message.startsWith("Fake Tool failed"));
});

test("a worker that forgets a requested file is reported", async () => {
  await assert.rejects(run("silent", { outputs: ["out.txt"] }), { code: "TOOL_FAILED", message: /did not produce out\.txt/ });
});

test("the worker gets a heap limit and a scrubbed environment", async () => {
  const r = await run("env", { opts: { heapMb: 256 } });
  assert.equal(r.result.options, "--max-old-space-size=256");
  assert.ok(!r.result.keys.some((k) => /TOKEN|SECRET|KEY/i.test(k)));
  assert.ok((await run("env")).result.options.endsWith("=768"));
});

test("runWorker writes result.json for success, handled errors and unknown jobs", async () => {
  const { readFile } = await import("node:fs/promises");
  const tools = [
    fakeTool({ manifest: { id: "w" } }),
  ];
  const withWorkers = [{ ...tools[0], workers: { good: async () => ({ ok: 1 }), nothing: async () => undefined, known: async () => { throw new ToolMasterError("POLICY_VIOLATION", "no"); }, other: async () => { throw new Error("x".repeat(500)); } } }];
  const result = async (job) => {
    const out = await mkdtemp(path.join(dir, "w-"));
    const code = await runWorker({ tools: withWorkers, toolId: "w", job, dir: out });
    return { code, body: code === 0 ? JSON.parse(await readFile(path.join(out, "result.json"), "utf8")) : null };
  };
  assert.deepEqual(await result("good"), { code: 0, body: { result: { ok: 1 } } });
  assert.deepEqual((await result("nothing")).body, { result: {} });
  assert.deepEqual((await result("known")).body, { error: { code: "POLICY_VIOLATION", message: "no" } });
  const other = (await result("other")).body.error;
  assert.equal(other.code, "TOOL_FAILED");
  assert.equal(other.message.length, 300);
  for (const job of ["missing", "constructor", "__proto__", "toString"]) assert.equal((await result(job)).code, 2, job);
  assert.equal(await runWorker({ tools: withWorkers, toolId: "nope", job: "good", dir }), 2);
});

test("defineTool accepts workers only as an object of functions", async () => {
  const { defineTool } = await import("../../sdk.mjs");
  const base = fakeTool().manifest;
  const run = async () => ({ data: Buffer.from("x") });
  assert.doesNotThrow(() => defineTool({ manifest: base, run, workers: { a: async () => ({}) } }));
  for (const workers of [null, "x", { a: 1 }]) assert.throws(() => defineTool({ manifest: base, run, workers }), { code: "TOOL_INVALID" });
});

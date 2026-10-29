import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { resolveOptions } from "../../runner.mjs";
import { validateManifest } from "../../manifest.mjs";
import { runCli } from "../../cli/index.mjs";
import { createToolMaster } from "../../index.mjs";
import { VERSION } from "../../version.mjs";
import { fakeTool, fakeManifest, fakeEngineSpec } from "../../../test/helpers/fake-tool.mjs";

let dir;
let tm;
const STRING = { id: "pages", label: "Pages", type: "string", default: "all", maxLength: 10 };

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tm-opts-"));
  tm = await createToolMaster({
    env: { TOOLMASTER_SANDBOX: "off" },
    projectRoot: dir,
    engines: [fakeEngineSpec({ id: "shared-engine", license: "MIT" })],
    tools: [
      fakeTool({
        manifest: {
          id: "texty", name: "Texty", useWhen: "You want text.", engines: ["shared-engine"],
          output: { contentType: "text/markdown", extension: "md" },
          options: [STRING],
        },
        run: async (_c, { input, options }) => ({ data: Buffer.from(`${input}|${options.pages}`), meta: { n: 1 } }),
      }),
      fakeTool({ manifest: { id: "binary-out", name: "Bin", output: { contentType: "application/pdf", extension: "pdf" } } }),
    ],
  });
});
after(() => rm(dir, { recursive: true, force: true }));

async function cli(args, stdin = "") {
  let out = "";
  let err = "";
  const code = await runCli(args, { tm, stdin: Readable.from([stdin]), stdout: { write: (s) => (out += s) }, stderr: { write: (s) => (err += s) }, interactive: false });
  return { code, out, err };
}

test("string options are defaulted, trimmed and limited", () => {
  const m = { options: [STRING] };
  assert.deepEqual(resolveOptions(m, {}), { pages: "all" });
  assert.deepEqual(resolveOptions(m, { pages: "  1-3 " }), { pages: "1-3" });
  for (const bad of [{ pages: 5 }, { pages: true }, { pages: "x".repeat(11) }, { pages: "a\0b" }]) assert.throws(() => resolveOptions(m, bad), { code: "INPUT_INVALID" });
  assert.deepEqual(resolveOptions({ options: [{ ...STRING, maxLength: undefined }] }, { pages: "x".repeat(200) }).pages.length, 200);
});

test("manifests: string options, catalog engine ids, text previews and useWhen are validated", () => {
  assert.doesNotThrow(() => validateManifest(fakeManifest({ options: [STRING], engines: ["pandoc", fakeEngineSpec({ id: "inline-e" })], preview: "text", useWhen: "Use it." })));
  const bad = (o) => assert.throws(() => validateManifest(fakeManifest(o)), { code: "TOOL_INVALID" });
  bad({ options: [{ ...STRING, default: 5 }] });
  bad({ options: [{ ...STRING, maxLength: 0 }] });
  bad({ options: [{ ...STRING, maxLength: 5000 }] });
  bad({ options: [{ ...STRING, default: "x".repeat(11) }] });
  bad({ options: [{ id: "x", label: "X", type: "number", default: 1 }] });
  bad({ engines: ["Not Kebab"] });
  bad({ engines: ["pandoc", "pandoc"] });
  bad({ engines: ["pandoc", fakeEngineSpec({ id: "pandoc" })] });
  bad({ preview: "video" });
  bad({ useWhen: "x".repeat(301) });
  bad({ useWhen: 5 });
});

test("-o - prints text results to stdout, as plain text or inside --json", async () => {
  const plain = await cli(["texty", "-i", "-", "-o", "-", "-O", "pages=2"], "hello");
  assert.equal(plain.code, 0);
  assert.equal(plain.out, "hello|2\n");
  const json = JSON.parse((await cli(["texty", "-i", "-", "-o", "-", "--json"], "hi")).out);
  assert.deepEqual([json.ok, json.content, json.bytes, json.meta], [true, "hi|all", 6, { n: 1 }]);
});

test("-o - refuses binary outputs and still validates the input", async () => {
  const r = await cli(["binary-out", "-i", "-", "-o", "-"], "x");
  assert.equal(r.code, 2);
  assert.match(r.err, /prints text only/);
  const file = path.join(dir, "in.txt");
  await writeFile(file, "from disk");
  assert.equal((await cli(["texty", "-i", file, "-o", "-"])).out, "from disk|all\n");
  assert.equal((await cli(["texty", "-i", path.join(dir, "missing.txt"), "-o", "-"])).code, 2);
});

test("help --json and list --json describe tools with engine ids, hints and no samples", async () => {
  const help = JSON.parse((await cli(["help", "texty", "--json"])).out);
  assert.equal(help.tool.useWhen, "You want text.");
  assert.deepEqual(help.tool.engines, ["shared-engine"]);
  assert.equal("sample" in help.tool, false);
  const text = (await cli(["help", "texty"])).out;
  assert.match(text, /use when: You want text\./);
  assert.match(text, /-O pages=text {3}Pages \(default "all"\)/);
  assert.match(text, /toolmaster texty -i input\.txt -o - --json/);
  const list = JSON.parse((await cli(["list", "--json"])).out);
  assert.deepEqual(list.tools.find((t) => t.id === "texty").engines, ["shared-engine"]);
});

test("install uses the shared catalog and installs each engine once", async () => {
  const seen = [];
  let out = "";
  const code = await runCli(["install"], { tm, stdout: { write: (s) => (out += s) }, stderr: { write() {} }, interactive: false, deps: { installEngine: async ({ spec }) => seen.push(spec.id) } });
  assert.equal(code, 0);
  assert.deepEqual(seen, ["shared-engine"]);
});

test("the version constant matches package.json", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
});

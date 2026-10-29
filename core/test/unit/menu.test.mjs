import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { runMenu } from "../../cli/menu.mjs";
import { createToolMaster } from "../../index.mjs";
import { fakeTool, fakeEngineSpec } from "../../../test/helpers/fake-tool.mjs";

let dir;
let tm;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tm-menu-"));
  tm = await createToolMaster({
    env: { TOOLMASTER_SANDBOX: "off" },
    projectRoot: dir,
    tools: [
      fakeTool({ manifest: { options: [{ id: "mode", label: "Mode", type: "enum", values: ["a", "b"], default: "a" }] } }),
      fakeTool({ manifest: { id: "needs-engine", name: "Needs Engine", engines: [fakeEngineSpec({ id: "e1", binary: "definitely-not-installed-xyz" })] } }),
    ],
  });
});
after(() => rm(dir, { recursive: true, force: true }));

async function menu(lines, deps = {}) {
  let out = "";
  const result = await runMenu({ tm, stdin: Readable.from(lines.map((l) => `${l}\n`)), stdout: { write: (s) => (out += s) }, deps });
  return { result, out };
}

test("shows every tool with readiness and quits on q or end of input", async () => {
  const a = await menu(["q"]);
  assert.equal(a.result, 0);
  assert.match(a.out, /1\) Open the web app/);
  assert.match(a.out, /2\) Fake Tool\n/);
  assert.match(a.out, /3\) Needs Engine {3}\[engine missing/);
  assert.equal((await menu([])).result, 0);
});

test("choosing a tool prompts for input, output and options, then runs it", async () => {
  const input = path.join(dir, "m.txt");
  const output = path.join(dir, "m.out");
  await writeFile(input, "menu");
  const r = await menu(["2", input, output, "b", "q"]);
  assert.match(r.out, /Done: .*m\.out/);
  assert.equal(await readFile(output, "utf8"), "MENU");
});

test("the suggested output name is the input name with the tool's extension", async () => {
  const input = path.join(dir, "n.txt");
  await writeFile(input, "x");
  const r = await menu(["2", input, "", "", "q"]);
  assert.match(r.out, new RegExp(`Output file \\[${path.join(dir, "n.out").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`));
  assert.equal(await readFile(path.join(dir, "n.out"), "utf8"), "X");
});

test("errors are explained and the menu continues", async () => {
  const r = await menu(["2", path.join(dir, "missing.txt"), "", "", "9", "x", "q"]);
  assert.match(r.out, /That did not work \[INPUT_INVALID\]/);
  assert.match(r.out, /Please type one of the numbers/);
  assert.ok((r.out.match(/Choose: /g) ?? []).length >= 3);
});

test("option 1 launches the web app and hands it back", async () => {
  const r = await menu(["1"], { launchUi: async (o) => ({ url: "u", open: o.open }) });
  assert.deepEqual(r.result, { ui: { url: "u", open: true } });
});

test("option i installs every distinct engine and survives failures", async () => {
  const ids = [];
  const r = await menu(["i", "q"], { installEngine: async ({ spec }) => { ids.push(spec.id); throw new Error("offline"); } });
  assert.deepEqual(ids, ["e1"]);
  assert.match(r.out, /could not install e1: offline/);
});

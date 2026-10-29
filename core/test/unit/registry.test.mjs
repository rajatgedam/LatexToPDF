import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateManifest, validateEngineSpec } from "../../manifest.mjs";
import { defineTool } from "../../sdk.mjs";
import { createRegistry, discoverTools } from "../../registry.mjs";
import { fakeManifest, fakeEngineSpec, fakeTool } from "../../../test/helpers/fake-tool.mjs";

const invalid = (m) => assert.throws(() => validateManifest(m), { code: "TOOL_INVALID" });

test("a minimal manifest is valid", () => {
  assert.doesNotThrow(() => validateManifest(fakeManifest()));
});

test("manifest rejects bad ids, missing fields and bad shapes", () => {
  invalid(fakeManifest({ id: "Bad_ID" }));
  invalid(fakeManifest({ id: "x".repeat(41) }));
  invalid(fakeManifest({ name: "" }));
  invalid(fakeManifest({ icon: "" }));
  invalid(fakeManifest({ input: { kind: "audio", accept: [".x"] } }));
  invalid(fakeManifest({ input: { kind: "text", accept: ["tex"] } }));
  invalid(fakeManifest({ input: { kind: "text", accept: [".tex"], maxBytes: -1 } }));
  invalid(fakeManifest({ output: { contentType: "pdf", extension: "pdf" } }));
  invalid(fakeManifest({ output: { contentType: "a/b", extension: ".pdf" } }));
  invalid(fakeManifest({ preview: "video" }));
  invalid(fakeManifest({ ui: {} }));
  invalid(fakeManifest({ sample: 5 }));
  invalid(null);
});

test("options are validated", () => {
  assert.doesNotThrow(() =>
    validateManifest(fakeManifest({ options: [{ id: "mode", label: "Mode", type: "enum", values: ["a", "b"], default: "a" }, { id: "toc", label: "TOC", type: "boolean", default: false }] })),
  );
  invalid(fakeManifest({ options: [{ id: "mode", label: "M", type: "enum", values: ["a"], default: "z" }] }));
  invalid(fakeManifest({ options: [{ id: "t", label: "T", type: "boolean", default: "no" }] }));
  invalid(fakeManifest({ options: [{ id: "t", label: "T", type: "number", default: 1 }] }));
  invalid(fakeManifest({ options: [{ id: "t", label: "T", type: "boolean", default: true }, { id: "t", label: "T", type: "boolean", default: true }] }));
});

test("engine specs need https assets with 64-hex checksums and known platforms", () => {
  assert.doesNotThrow(() => validateEngineSpec(fakeEngineSpec()));
  const bad = (o) => assert.throws(() => validateEngineSpec(fakeEngineSpec(o)), { code: "TOOL_INVALID" });
  bad({ binary: "../evil" });
  bad({ assets: {} });
  bad({ assets: { "plan9-mips": { url: "https://x.test/a", sha256: "a".repeat(64) } } });
  bad({ assets: { "linux-x64": { url: "http://x.test/a", sha256: "a".repeat(64) } } });
  bad({ assets: { "linux-x64": { url: "https://x.test/a", sha256: "abc" } } });
  bad({ versionArgs: "--version" });
  invalid(fakeManifest({ engines: [fakeEngineSpec(), fakeEngineSpec()] }));
});

test("defineTool requires run(), a valid manifest and preview() for html previews", () => {
  assert.throws(() => defineTool({ manifest: fakeManifest() }), { code: "TOOL_INVALID" });
  assert.throws(() => defineTool({ manifest: fakeManifest({ preview: "html" }), run() {} }), { code: "TOOL_INVALID" });
  assert.throws(() => defineTool({ manifest: { id: "x" }, run() {} }), { code: "TOOL_INVALID" });
  const tool = fakeTool();
  assert.ok(Object.isFrozen(tool));
  assert.ok(Object.isFrozen(tool.manifest));
});

test("registry lists, gets and sorts tools; duplicates are refused", () => {
  const a = fakeTool({ manifest: { id: "zeta", name: "Zeta", category: "b" } });
  const b = fakeTool({ manifest: { id: "alpha", name: "Alpha", category: "b" } });
  const c = fakeTool({ manifest: { id: "first", name: "First", category: "a" } });
  const reg = createRegistry([a, b, c]);
  assert.deepEqual(reg.ids(), ["first", "alpha", "zeta"]);
  assert.equal(reg.get("alpha"), b);
  assert.equal(reg.has("nope"), false);
  assert.throws(() => reg.get("nope"), { code: "TOOL_NOT_FOUND" });
  assert.throws(() => createRegistry([a, a]), { code: "TOOL_INVALID" });
  assert.throws(() => createRegistry([{}]), { code: "TOOL_INVALID" });
});

async function toolsDirWith(ids) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tm-tools-"));
  const sdk = path.resolve(import.meta.dirname, "../../sdk.mjs");
  for (const id of ids) {
    await mkdir(path.join(dir, id));
    await writeFile(
      path.join(dir, id, "tool.mjs"),
      `import { defineTool } from ${JSON.stringify(sdk)};
export default defineTool({ manifest: { id: ${JSON.stringify(id)}, name: ${JSON.stringify(id)}, description: "d", category: "c", icon: "T", input: { kind: "text", accept: [".txt"] }, output: { contentType: "text/plain", extension: "out" }, preview: "none", ui: { action: "Go" } }, run: async () => ({ data: Buffer.from("x") }) });`,
    );
  }
  await mkdir(path.join(dir, "not-a-tool"));
  await writeFile(path.join(dir, "stray.txt"), "x");
  return dir;
}

test("discoverTools loads every folder that has a tool.mjs and ignores the rest", async () => {
  const dir = await toolsDirWith(["one", "two"]);
  try {
    assert.deepEqual((await discoverTools(dir)).map((t) => t.manifest.id), ["one", "two"]);
    assert.deepEqual((await discoverTools(dir, { only: ["two"] })).map((t) => t.manifest.id), ["two"]);
    await assert.rejects(discoverTools(dir, { only: ["ghost"] }), { code: "TOOL_NOT_FOUND" });
    assert.deepEqual(await discoverTools(path.join(dir, "missing")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a tool whose id differs from its folder name is rejected", async () => {
  const dir = await toolsDirWith(["one"]);
  try {
    await mkdir(path.join(dir, "wrong-name"));
    await writeFile(path.join(dir, "wrong-name", "tool.mjs"), await (await import("node:fs/promises")).readFile(path.join(dir, "one", "tool.mjs"), "utf8"));
    await assert.rejects(discoverTools(dir), { code: "TOOL_INVALID" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

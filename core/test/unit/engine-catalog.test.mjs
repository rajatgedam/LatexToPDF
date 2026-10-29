import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEngineCatalog, discoverEngines } from "../../engine-catalog.mjs";
import { fakeEngineSpec } from "../../../test/helpers/fake-tool.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);

test("a catalog looks engines up by id and rejects unknown ids with a hint", () => {
  const catalog = createEngineCatalog([fakeEngineSpec({ id: "alpha" }), fakeEngineSpec({ id: "beta" })]);
  assert.deepEqual(catalog.ids(), ["alpha", "beta"]);
  assert.equal(catalog.get("beta").id, "beta");
  assert.throws(() => catalog.get("gamma"), { code: "TOOL_INVALID", message: /engines\/gamma\.mjs/ });
});

test("duplicate or malformed specs are rejected when the catalog is built", () => {
  assert.throws(() => createEngineCatalog([fakeEngineSpec({ id: "a" }), fakeEngineSpec({ id: "a" })]), { code: "TOOL_INVALID", message: /Duplicate engine/ });
  assert.throws(() => createEngineCatalog([fakeEngineSpec({ id: "Bad Id" })]), { code: "TOOL_INVALID" });
});

test("manifests may name catalog engines or carry inline specs; shared engines are listed once", () => {
  const catalog = createEngineCatalog([fakeEngineSpec({ id: "alpha" })]);
  const inline = fakeEngineSpec({ id: "inline-one" });
  assert.deepEqual(catalog.forManifest({ engines: ["alpha", inline] }).map((e) => e.id), ["alpha", "inline-one"]);
  assert.deepEqual(catalog.forManifest({}), []);
  assert.deepEqual(catalog.forManifests([{ engines: ["alpha"] }, { engines: ["alpha", inline] }]).map((e) => e.id), ["alpha", "inline-one"]);
  assert.throws(() => catalog.forManifest({ engines: ["missing"] }), { code: "TOOL_INVALID" });
});

test("the repository's engines folder loads and every file is named after its engine id", async () => {
  const specs = await discoverEngines(path.join(here, "..", "..", "..", "engines"));
  assert.ok(specs.some((s) => s.id === "pandoc") && specs.some((s) => s.id === "tectonic"));
  assert.doesNotThrow(() => createEngineCatalog(specs));
});

test("a file whose spec id differs from its name is refused; a missing folder is just empty", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tm-engines-"));
  try {
    await writeFile(path.join(dir, "wrong.mjs"), "export default { id: 'other' };\n");
    await assert.rejects(discoverEngines(dir), { code: "TOOL_INVALID", message: /wrong\.mjs/ });
    assert.deepEqual(await discoverEngines(path.join(dir, "nope")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

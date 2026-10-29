import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createToolMaster } from "../../index.mjs";
import { renderCatalog } from "../../catalog.mjs";
import { createEngineCatalog } from "../../engine-catalog.mjs";
import { fakeManifest, fakeEngineSpec } from "../../../test/helpers/fake-tool.mjs";

test("TOOLS.md is exactly what the manifests generate (run `npm run catalog` after changing a tool)", async () => {
  const tm = await createToolMaster({ env: {} });
  const expected = `${renderCatalog(tm.registry.list().map((t) => t.manifest), tm.engines).trimEnd()}\n`;
  const actual = await readFile(new URL("../../../TOOLS.md", import.meta.url), "utf8");
  assert.equal(actual, expected);
});

test("every shipped tool carries what an AI needs to choose it: a use-when hint and a runnable example", async () => {
  const tm = await createToolMaster({ env: {} });
  for (const { manifest: m } of tm.registry.list()) {
    assert.ok(m.useWhen && m.useWhen.length > 20, `${m.id} needs useWhen`);
    assert.ok(m.tags?.length, `${m.id} needs tags`);
  }
});

test("the catalog lists readers, writers, engines and options, sorted by category", () => {
  const catalog = createEngineCatalog([fakeEngineSpec({ id: "eng", license: "GPL-2.0-or-later" })]);
  const md = renderCatalog(
    [
      fakeManifest({ id: "z-last", name: "Z", category: "B", icon: "Z", engines: ["eng"], options: [{ id: "mode", label: "Mode", type: "enum", values: ["a", "b"], default: "a" }, { id: "p", label: "P", type: "string", default: "all", help: "hint" }] }),
      fakeManifest({ id: "a-first", name: "A", category: "A", icon: "A", output: { contentType: "text/markdown", extension: "md" }, useWhen: "Use me." }),
    ],
    catalog,
  );
  assert.ok(md.indexOf("## A A (`a-first`)") < md.indexOf("## Z Z (`z-last`)"));
  assert.match(md, /\*\*Use when:\*\* Use me\./);
  assert.match(md, /- Needs: eng \(GPL-2\.0-or-later\)/);
  assert.match(md, /- Needs: nothing to install/);
  assert.match(md, /\| `mode` \| a \\\| b \| `"a"` \| Mode \|/);
  assert.match(md, /\| `p` \| text \| `"all"` \| P\. hint \|/);
  assert.match(md, /toolmaster a-first -i input\.txt -o -\n/);
  assert.match(md, /toolmaster z-last -i input\.txt -o - -O mode=b\n/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { planRelease, dockerImages, RELEASE_OS } from "../../../scripts/plan-lib.mjs";

const TOOLS = [
  { id: "latex-to-pdf", engines: ["tectonic"] },
  { id: "pdf-pages", engines: [] },
];

test("a dry run builds only the all-in-one bundle on every OS", () => {
  const plan = planRelease({ tools: TOOLS, full: false });
  assert.equal(plan.length, RELEASE_OS.length);
  assert.ok(plan.every((p) => p.bundle === "all" && p.runtime === "sea" && p.tools === "" && !p.portable));
});

test("a release adds each tool on its own, a lite all-in-one per OS, and one lite download per engine-free tool", () => {
  const plan = planRelease({ tools: TOOLS, full: true });
  const perOs = RELEASE_OS.length * (1 + TOOLS.length + 1);
  assert.equal(plan.length, perOs + 1);
  const mac = plan.filter((p) => p.os === "macos-latest");
  assert.deepEqual(mac.map((p) => `${p.bundle}:${p.runtime}`), ["all:sea", "latex-to-pdf:sea", "pdf-pages:sea", "all:node"]);
  const portable = plan.filter((p) => p.portable);
  assert.deepEqual(portable, [{ os: "ubuntu-latest", name: "any-pdf-pages-node", bundle: "pdf-pages", tools: "pdf-pages", runtime: "node", portable: true }]);
  assert.equal(new Set(plan.map((p) => p.name)).size, plan.length, "names are unique so artifacts never collide");
});

test("docker images: everything, plus one image per tool", () => {
  assert.deepEqual(dockerImages(TOOLS), [
    { image: "toolmaster", tools: "all" },
    { image: "toolmaster-latex-to-pdf", tools: "latex-to-pdf" },
    { image: "toolmaster-pdf-pages", tools: "pdf-pages" },
  ]);
});

test("every tool in the repository has a smoke case, so a new tool cannot ship untested", async () => {
  const ids = (await readdir(new URL("../../../tools", import.meta.url), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  assert.ok(ids.length >= 4);
  for (const script of ["smoke-bundle.mjs", "smoke-http.mjs"]) {
    const smoke = await readFile(new URL(`../../../scripts/${script}`, import.meta.url), "utf8");
    for (const id of ids) assert.match(smoke, new RegExp(`"${id}"\\(`), `scripts/${script} needs a case for ${id}`);
  }
});

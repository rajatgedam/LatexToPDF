import { test } from "node:test";
import assert from "node:assert/strict";
import {
  packageName, exeName, bundleName, parseToolsArg, launcherFor, liteCommandFor, entrySource, noticesText, readmeText, seaConfig,
  postjectArgs, bundledPackageDirs, packQuality, SENTINEL,
} from "../../../scripts/build-lib.mjs";

const AVAILABLE = ["doc-to-markdown", "latex-to-docx", "latex-to-pdf", "pdf-pages"];

test("package names say which tools, which runtime and which platform", () => {
  assert.equal(packageName("all", "darwin", "arm64"), "ToolMaster-all-darwin-arm64");
  assert.equal(packageName("latex-to-docx", "linux", "x64"), "ToolMaster-latex-to-docx-linux-x64");
  assert.equal(packageName("all", "linux", "x64", { runtime: "node" }), "ToolMaster-all-lite-linux-x64");
  assert.equal(packageName("pdf-pages", "linux", "x64", { runtime: "node", portable: true }), "ToolMaster-pdf-pages-lite", "no engines: the same on every OS");
  assert.equal(packageName("x", "win32", "x64", { runtime: "sea", portable: true }), "ToolMaster-x-win32-x64", "a bundled runtime is always platform specific");
  assert.equal(exeName("darwin"), "toolmaster");
  assert.equal(exeName("win32"), "toolmaster.exe");
});

test("bundleName is `all` only when every tool is included", () => {
  assert.equal(bundleName(AVAILABLE, AVAILABLE), "all");
  assert.equal(bundleName(["latex-to-pdf"], AVAILABLE), "latex-to-pdf");
  assert.equal(bundleName(["b", "a"], ["a", "b", "c"]), "a+b");
});

test("parseToolsArg defaults to everything, dedupes, and refuses typos", () => {
  assert.deepEqual(parseToolsArg(undefined, AVAILABLE), AVAILABLE);
  assert.deepEqual(parseToolsArg("all", AVAILABLE), AVAILABLE);
  assert.deepEqual(parseToolsArg("pdf-pages, pdf-pages", AVAILABLE), ["pdf-pages"]);
  assert.throws(() => parseToolsArg("pdf-pagez", AVAILABLE), /Unknown tool\(s\): pdf-pagez/);
  assert.throws(() => parseToolsArg(",", AVAILABLE), /none given/);
});

test("launchers start the UI from their own folder, with or without a bundled runtime", () => {
  const mac = launcherFor("darwin");
  assert.deepEqual([mac.file, mac.executable], ["ToolMaster.command", true]);
  assert.match(mac.content, /^#!\/bin\/sh/);
  assert.match(mac.content, /cd "\$\(dirname "\$0"\)"/);
  assert.match(mac.content, /exec \.\/toolmaster ui/);
  assert.equal(launcherFor("linux").file, "ToolMaster.sh");
  const win = launcherFor("win32");
  assert.equal(win.file, "ToolMaster.bat");
  assert.match(win.content, /toolmaster\.exe" ui/);
  assert.match(win.content, /\r\n/);

  const lite = launcherFor("darwin", "node");
  assert.match(lite.content, /command -v node/);
  assert.match(lite.content, /node "\$\(dirname "\$0"\)\/toolmaster\.cjs" ui/);
  assert.match(launcherFor("win32", "node").content, /node "%~dp0toolmaster\.cjs" ui/);
});

test("lite bundles get a command that checks for Node and forwards every argument", () => {
  const sh = liteCommandFor("linux");
  assert.deepEqual([sh.file, sh.executable], ["toolmaster", true]);
  assert.match(sh.content, /Node\.js 22\.13/);
  assert.match(sh.content, /exec node "\$\(dirname "\$0"\)\/toolmaster\.cjs" "\$@"/);
  const cmd = liteCommandFor("win32");
  assert.equal(cmd.file, "toolmaster.cmd");
  assert.match(cmd.content, /node "%~dp0toolmaster\.cjs" %\*\r\n/);
});

test("the generated entry imports only the chosen tools and the engines they name", () => {
  const src = entrySource({ coreDir: "/r/core", toolsDir: "/r/tools", enginesDir: "/r/engines", toolIds: ["latex-to-docx"], engineIds: ["pandoc"] });
  assert.match(src, /import tool0 from "\/r\/tools\/latex-to-docx\/tool\.mjs";/);
  assert.match(src, /import engine0 from "\/r\/engines\/pandoc\.mjs";/);
  assert.ok(!src.includes("latex-to-pdf") && !src.includes("tectonic"));
  assert.match(src, /const tools = \[tool0\];/);
  assert.match(src, /const engines = \[engine0\];/);
  assert.match(src, /main\(process\.argv\.slice\(2\), \{ tools, engines \}\)\.then\(finish/);
  const two = entrySource({ coreDir: "C:\\r\\core", toolsDir: "C:\\r\\tools", enginesDir: "C:\\r\\engines", toolIds: ["a", "b"] });
  assert.match(two, /const tools = \[tool0, tool1\];/);
  assert.match(two, /const engines = \[\];/);
  assert.match(two, /"C:\/r\/tools\/b\/tool\.mjs"/);
});

test("bundled package folders are found in esbuild's input list, scoped and nested names included", () => {
  assert.deepEqual(
    bundledPackageDirs([
      "core/mcp.mjs",
      "node_modules/tslib/tslib.es6.js",
      "node_modules/tslib/modules/index.js",
      "node_modules/@cantoo/pdf-lib/cjs/index.js",
      "node_modules/@cantoo/pdf-lib/node_modules/inner/index.js",
      "node_modules\\win\\index.js",
    ]),
    ["node_modules/@cantoo/pdf-lib", "node_modules/@cantoo/pdf-lib/node_modules/inner", "node_modules/tslib", "node_modules/win"],
  );
});

test("notices list engines (once each) and bundled packages with their licence texts", () => {
  const text = noticesText({
    engines: [{ id: "pandoc", license: "GPL-2.0-or-later", homepage: "https://pandoc.org" }, { id: "pandoc", license: "dup", homepage: "dup" }, { id: "tectonic", license: "MIT", homepage: "https://t.example" }],
    packages: [{ name: "pdfjs-dist", version: "1.2.3", license: "Apache-2.0", text: "Apache License text" }, { name: "bare", version: "0.1.0", license: "MIT", text: "" }],
    runtime: "sea",
  });
  assert.match(text, /- pandoc: GPL-2\.0-or-later\. Source and licence: https:\/\/pandoc\.org/);
  assert.match(text, /- tectonic: MIT/);
  assert.equal((text.match(/- pandoc:/g) ?? []).length, 1);
  assert.match(text, /Node\.js \(the launcher runtime\)/);
  assert.match(text, /- pdfjs-dist 1\.2\.3: Apache-2\.0/);
  assert.match(text, /pdfjs-dist 1\.2\.3 \(Apache-2\.0\)\n\nApache License text/);
  assert.match(text, /\(no licence file shipped with the package/);
  const lite = noticesText({ engines: [], packages: [], runtime: "node" });
  assert.ok(!lite.includes("Node.js") && !lite.includes("separate programs") && !lite.includes("JavaScript packages"));
});

test("the read-me tells the truth about runtime and engines", () => {
  const sea = readmeText({ toolIds: ["latex-to-pdf"], runtime: "sea", enginesBundled: true, launcher: "ToolMaster.command", platform: "darwin" });
  assert.match(sea, /\.\/toolmaster mcp/);
  assert.match(sea, /unpack themselves on first use/);
  assert.match(sea, /xattr -dr com\.apple\.quarantine/);
  const lite = readmeText({ toolIds: ["pdf-pages"], runtime: "node", enginesBundled: false, needsEngines: false, launcher: "ToolMaster.bat", platform: "win32" });
  assert.match(lite, /toolmaster\.cmd mcp/);
  assert.match(lite, /needs Node\.js 22\.13/);
  assert.doesNotMatch(lite, /ngines/);
  assert.match(readmeText({ toolIds: ["x"], runtime: "node", enginesBundled: false, launcher: "a", platform: "linux" }), /run `\.\/toolmaster install` once/);
});

test("sea config disables the warning and names the blob", () => {
  assert.deepEqual(seaConfig({ main: "a.cjs", output: "b.blob" }), { main: "a.cjs", output: "b.blob", disableExperimentalSEAWarning: true });
});

test("postject args include the sentinel fuse and the mach-o segment on macOS only", () => {
  const mac = postjectArgs({ exe: "x", blob: "b", platform: "darwin" });
  assert.deepEqual(mac.slice(0, 3), ["x", "NODE_SEA_BLOB", "b"]);
  assert.ok(mac.includes(SENTINEL));
  assert.ok(mac.join(" ").includes("--macho-segment-name NODE_SEA"));
  assert.ok(!postjectArgs({ exe: "x", blob: "b", platform: "linux" }).includes("--macho-segment-name"));
});

test("pack quality is maximal for releases, quick for local builds, and validated", () => {
  assert.equal(packQuality({ zip: true }), 11);
  assert.equal(packQuality({ zip: false }), 7);
  assert.equal(packQuality({ explicit: "3", zip: true }), 3);
  for (const bad of ["12", "-1", "1.5", "x"]) assert.throws(() => packQuality({ explicit: bad }), /0 to 11/);
});

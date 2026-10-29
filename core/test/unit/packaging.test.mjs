import { test } from "node:test";
import assert from "node:assert/strict";
import { packageName, exeName, bundleName, parseToolsArg, launcherFor, entrySource, noticesText, seaConfig, postjectArgs, SENTINEL } from "../../../scripts/build-lib.mjs";

const AVAILABLE = ["latex-to-docx", "latex-to-pdf"];

test("package and executable names are bundle and platform specific", () => {
  assert.equal(packageName("all", "darwin", "arm64"), "ToolMaster-all-darwin-arm64");
  assert.equal(packageName("latex-to-docx", "linux", "x64"), "ToolMaster-latex-to-docx-linux-x64");
  assert.equal(exeName("darwin"), "toolmaster");
  assert.equal(exeName("win32"), "toolmaster.exe");
});

test("bundleName is `all` only when every tool is included", () => {
  assert.equal(bundleName(["latex-to-pdf", "latex-to-docx"], AVAILABLE), "all");
  assert.equal(bundleName(["latex-to-pdf"], AVAILABLE), "latex-to-pdf");
  assert.equal(bundleName(["b", "a"], ["a", "b", "c"]), "a+b");
});

test("parseToolsArg defaults to everything, dedupes, and refuses typos", () => {
  assert.deepEqual(parseToolsArg(undefined, AVAILABLE), AVAILABLE);
  assert.deepEqual(parseToolsArg("all", AVAILABLE), AVAILABLE);
  assert.deepEqual(parseToolsArg("latex-to-pdf, latex-to-pdf", AVAILABLE), ["latex-to-pdf"]);
  assert.throws(() => parseToolsArg("latex-to-pdff", AVAILABLE), /Unknown tool\(s\): latex-to-pdff/);
  assert.throws(() => parseToolsArg(",", AVAILABLE), /none given/);
});

test("launchers start the UI from their own folder", () => {
  const mac = launcherFor("darwin");
  assert.equal(mac.file, "ToolMaster.command");
  assert.equal(mac.executable, true);
  assert.match(mac.content, /^#!\/bin\/sh/);
  assert.match(mac.content, /cd "\$\(dirname "\$0"\)"/);
  assert.match(mac.content, /exec \.\/toolmaster ui/);
  assert.equal(launcherFor("linux").file, "ToolMaster.sh");
  const win = launcherFor("win32");
  assert.equal(win.file, "ToolMaster.bat");
  assert.match(win.content, /toolmaster\.exe" ui/);
  assert.match(win.content, /\r\n/);
});

test("the generated entry imports only the chosen tools", () => {
  const src = entrySource({ coreDir: "/r/core", toolsDir: "/r/tools", toolIds: ["latex-to-docx"] });
  assert.match(src, /import tool0 from "\/r\/tools\/latex-to-docx\/tool\.mjs";/);
  assert.ok(!src.includes("latex-to-pdf"));
  assert.match(src, /const tools = \[tool0\];/);
  assert.match(src, /main\(process\.argv\.slice\(2\), \{ tools \}\)\.then\(finish/);
  const two = entrySource({ coreDir: "C:\\r\\core", toolsDir: "C:\\r\\tools", toolIds: ["a", "b"] });
  assert.match(two, /const tools = \[tool0, tool1\];/);
  assert.match(two, /"C:\/r\/tools\/b\/tool\.mjs"/);
});

test("notices list every bundled engine with its licence and homepage", () => {
  const text = noticesText([
    { engines: [{ id: "pandoc", license: "GPL-2.0-or-later", homepage: "https://pandoc.org" }] },
    { engines: [{ id: "pandoc", license: "dup", homepage: "dup" }, { id: "tectonic", license: "MIT", homepage: "https://t.example" }] },
    {},
  ]);
  assert.match(text, /- pandoc: GPL-2\.0-or-later\. Source and licence: https:\/\/pandoc\.org/);
  assert.match(text, /- tectonic: MIT/);
  assert.equal((text.match(/- pandoc:/g) ?? []).length, 1);
  assert.match(text, /Node\.js/);
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

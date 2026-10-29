import { test } from "node:test";
import assert from "node:assert/strict";
import { packageName, exeName, launcherFor, seaConfig, postjectArgs, SENTINEL } from "../../scripts/build-lib.mjs";

test("package and executable names are platform specific", () => {
  assert.equal(packageName("darwin", "arm64"), "LatexToPDF-darwin-arm64");
  assert.equal(exeName("darwin"), "latex2pdf");
  assert.equal(exeName("win32"), "latex2pdf.exe");
});

test("launchers start the UI from their own folder", () => {
  const mac = launcherFor("darwin");
  assert.equal(mac.file, "LatexToPDF.command");
  assert.equal(mac.executable, true);
  assert.match(mac.content, /^#!\/bin\/sh/);
  assert.match(mac.content, /cd "\$\(dirname "\$0"\)"/);
  assert.match(mac.content, /exec \.\/latex2pdf ui/);
  assert.equal(launcherFor("linux").file, "LatexToPDF.sh");
  const win = launcherFor("win32");
  assert.equal(win.file, "LatexToPDF.bat");
  assert.match(win.content, /latex2pdf\.exe" ui/);
  assert.match(win.content, /\r\n/);
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

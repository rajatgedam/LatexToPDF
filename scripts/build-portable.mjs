#!/usr/bin/env node
// Builds a portable folder: single-file Node SEA launcher + web UI + Tectonic engine (+ warmed package cache).
//   npm run package [-- --no-cache] [--zip] [--rebuild-web]
import { spawnSync } from "node:child_process";
import { cp, mkdir, rm, writeFile, chmod, copyFile, stat, access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { packageName, exeName, launcherFor, seaConfig, postjectArgs } from "./build-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Set(process.argv.slice(2));
const { platform, arch } = process;
const name = packageName(platform, arch);
const outDir = path.join(root, "dist", name);
const work = path.join(root, "dist", ".build");
const exe = path.join(outDir, exeName(platform));

const exists = (p) => access(p).then(() => true, () => false);
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] ?? ""} failed with status ${r.status}`);
};
const dirSize = async (dir) => {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += (await stat(path.join(e.parentPath, e.name))).size;
  }
  return total;
};
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

const engine = path.join(root, "vendor", "tectonic", platform === "win32" ? "tectonic.exe" : "tectonic");
if (!(await exists(engine))) throw new Error("Engine missing. Run `npm run install:engine` first.");
if (flags.has("--rebuild-web") || !(await exists(path.join(root, "web", "dist", "index.html")))) {
  run("npm", ["--prefix", "web", "install"]);
  run("npm", ["run", "build:web"]);
}

await rm(outDir, { recursive: true, force: true });
await rm(work, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await mkdir(work, { recursive: true });

console.log("1/5 bundling server + CLI into one CommonJS file");
const bundle = path.join(work, "bundle.cjs");
await build({
  entryPoints: [path.join(root, "src", "portable-entry.mjs")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  define: { "import.meta.url": "undefined" },
  logLevel: "warning",
  legalComments: "none",
});

console.log("2/5 preparing the Node single-executable blob");
const cfgPath = path.join(work, "sea-config.json");
const blob = path.join(work, "sea.blob");
await writeFile(cfgPath, JSON.stringify(seaConfig({ main: bundle, output: blob })));
run(process.execPath, ["--experimental-sea-config", cfgPath]);

console.log("3/5 creating the executable");
await copyFile(process.execPath, exe);
await chmod(exe, 0o755);
if (platform === "darwin") {
  const info = spawnSync("lipo", ["-info", exe], { encoding: "utf8" }).stdout ?? "";
  if (/Architectures in the fat file/.test(info)) {
    const slim = `${exe}.slim`;
    run("lipo", [exe, "-thin", arch === "x64" ? "x86_64" : arch, "-output", slim]);
    await rm(exe);
    await copyFile(slim, exe);
    await rm(slim);
    await chmod(exe, 0o755);
  }
  run("codesign", ["--remove-signature", exe]);
}
run(path.join(root, "node_modules", ".bin", platform === "win32" ? "postject.cmd" : "postject"), postjectArgs({ exe, blob, platform }));
if (platform === "darwin") run("codesign", ["--sign", "-", exe]);

console.log("4/5 copying engine, web UI, cache and docs");
await mkdir(path.join(outDir, "vendor"), { recursive: true });
await cp(path.join(root, "vendor", "tectonic"), path.join(outDir, "vendor", "tectonic"), { recursive: true });
await mkdir(path.join(outDir, "web"), { recursive: true });
await cp(path.join(root, "web", "dist"), path.join(outDir, "web", "dist"), { recursive: true });
const cache = path.join(root, "vendor", "tectonic-cache");
if (!flags.has("--no-cache") && (await exists(cache))) await cp(cache, path.join(outDir, "vendor", "tectonic-cache"), { recursive: true });
await mkdir(path.join(outDir, "examples"), { recursive: true });
await cp(path.join(root, "examples", "resume.tex"), path.join(outDir, "examples", "resume.tex"));
await cp(path.join(root, "LICENSE"), path.join(outDir, "LICENSE"));
const launcher = launcherFor(platform);
await writeFile(path.join(outDir, launcher.file), launcher.content, { mode: launcher.executable ? 0o755 : 0o644 });
await writeFile(
  path.join(outDir, "READ-ME-FIRST.txt"),
  [
    "LatexToPDF (portable)",
    "",
    `Double-click ${launcher.file} (or run ./${exeName(platform)} ui). Your browser opens the editor.`,
    `CLI for scripts and agents: ./${exeName(platform)} -i resume.tex -o resume.pdf --json`,
    "Everything runs locally; nothing leaves your machine except Tectonic's package downloads on first use of a new LaTeX package.",
    "Offline: set LATEX2PDF_OFFLINE=1 (the bundled cache covers common resume packages).",
    "macOS blocks files downloaded from the internet: run `xattr -dr com.apple.quarantine .` in this folder once.",
    "Engine: Tectonic (MIT), https://github.com/tectonic-typesetting/tectonic",
    "",
  ].join("\n"),
);

console.log("5/5 done");
await rm(work, { recursive: true, force: true });
if (flags.has("--zip")) {
  const zip = path.join(root, "dist", `${name}.zip`);
  await rm(zip, { force: true });
  if (platform === "darwin") run("ditto", ["-c", "-k", "--keepParent", outDir, zip]);
  else run("zip", ["-qr", zip, name], { cwd: path.join(root, "dist") });
  console.log(`zip: ${zip} (${mb((await stat(zip)).size)})`);
}
console.log(`portable folder: ${outDir}`);
console.log(`executable: ${mb((await stat(exe)).size)}, total folder: ${mb(await dirSize(outDir))}`);

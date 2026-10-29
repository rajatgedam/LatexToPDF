#!/usr/bin/env node
// Builds a portable folder with only the chosen tools, their engines (+ warmed caches) and the web app.
//   npm run package -- [--tools all|a,b] [--runtime sea|node] [--engines bundled|download]
//                      [--no-cache] [--no-pack] [--pack-quality 0-11] [--zip] [--out <dir>] [--rebuild-web]
//
//   --runtime sea   (default) one executable that carries its own Node runtime; runs on a bare machine
//   --runtime node  "lite": toolmaster.cjs + a small launcher; needs Node 22.13+, saves about 100 MB
//   --engines bundled (default) ship the engines, compressed (Brotli) and unpacked on first use
//   --engines download  ship none; `toolmaster install` fetches them (checksum-verified)
import { spawnSync } from "node:child_process";
import { cp, mkdir, rm, writeFile, readFile, chmod, copyFile, stat, access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { discoverTools } from "../core/registry.mjs";
import { createEngineCatalog, discoverEngines } from "../core/engine-catalog.mjs";
import { createPack } from "../core/pack.mjs";
import {
  packageName, bundleName, exeName, launcherFor, liteCommandFor, parseToolsArg, entrySource, noticesText, readmeText,
  seaConfig, postjectArgs, bundledPackageDirs, packQuality,
} from "./build-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = new Set(args);
const valueOf = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const { platform, arch } = process;

const runtime = valueOf("--runtime") ?? "sea";
const enginesMode = valueOf("--engines") ?? "bundled";
if (!["sea", "node"].includes(runtime)) throw new Error("--runtime must be sea or node");
if (!["bundled", "download"].includes(enginesMode)) throw new Error("--engines must be bundled or download");
const quality = packQuality({ explicit: valueOf("--pack-quality"), zip: flags.has("--zip") });

const exists = (p) => access(p).then(() => true, () => false);
const run = (cmd, a, opts = {}) => {
  // npm is a .cmd shim on Windows and needs a shell; all arguments here are fixed strings.
  const r = spawnSync(cmd, a, { stdio: "inherit", cwd: root, shell: platform === "win32" && cmd === "npm", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${a[0] ?? ""} failed with status ${r.status}`);
};
const dirSize = async (dir) => {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += (await stat(path.join(e.parentPath, e.name))).size;
  }
  return total;
};
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const binaryOf = (e) => (platform === "win32" && !e.binary.endsWith(".exe") ? `${e.binary}.exe` : e.binary);

const toolsDir = path.join(root, "tools");
const enginesDir = path.join(root, "engines");
const allTools = await discoverTools(toolsDir);
const catalog = createEngineCatalog(await discoverEngines(enginesDir));
const available = allTools.map((t) => t.manifest.id);
const toolIds = parseToolsArg(valueOf("--tools"), available);
const manifests = allTools.filter((t) => toolIds.includes(t.manifest.id)).map((t) => t.manifest);
const engines = catalog.forManifests(manifests);
const shipEngines = enginesMode === "bundled" && engines.length > 0;
const portable = runtime === "node" && !shipEngines;

const bundle = bundleName(toolIds, available);
const name = packageName(bundle, platform, arch, { runtime, portable });
const outDir = valueOf("--out") ? path.resolve(valueOf("--out")) : path.join(root, "dist", name);
const work = path.join(root, "dist", ".build", name);
const exe = path.join(outDir, exeName(platform));

if (shipEngines) {
  for (const e of engines) {
    if (!(await exists(path.join(root, "vendor", e.id, binaryOf(e))))) throw new Error(`Engine "${e.id}" is missing. Run \`node bin/toolmaster.mjs install ${toolIds.join(" ")}\` first.`);
  }
}
if (flags.has("--rebuild-web") || !(await exists(path.join(root, "web", "dist", "index.html")))) {
  run("npm", ["--prefix", "web", "install"]);
  run("npm", ["run", "build:web"]);
}

await rm(outDir, { recursive: true, force: true });
await rm(work, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await mkdir(work, { recursive: true });

console.log(`Packaging "${bundle}" (${toolIds.join(", ")}) as ${runtime === "sea" ? "single executable" : "lite (Node 22.13+)"}, engines ${shipEngines ? "bundled" : enginesMode === "download" ? "downloaded later" : "not needed"}, ${portable ? "any OS" : `${platform}/${arch}`}`);
console.log("1/5 bundling the core, the chosen tools and their libraries into one CommonJS file");
const entry = path.join(work, "entry.mjs");
await writeFile(entry, entrySource({ coreDir: path.join(root, "core"), toolsDir, enginesDir, toolIds, engineIds: engines.map((e) => e.id) }));
const bundled = path.join(work, "bundle.cjs");
const built = await build({
  entryPoints: [entry],
  outfile: bundled,
  bundle: true,
  minify: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  define: { "import.meta.url": "undefined" },
  logLevel: "warning",
  legalComments: "none",
  metafile: true,
  absWorkingDir: root,
});
const packages = [];
for (const dir of bundledPackageDirs(Object.keys(built.metafile.inputs))) {
  const pkgDir = path.join(root, dir);
  const pkg = JSON.parse(await readFile(path.join(pkgDir, "package.json"), "utf8"));
  const licenseFile = (await readdir(pkgDir)).find((f) => /^(licen[cs]e|copying)/i.test(f));
  packages.push({ name: pkg.name, version: pkg.version, license: typeof pkg.license === "string" ? pkg.license : "see package", text: licenseFile ? await readFile(path.join(pkgDir, licenseFile), "utf8") : "" });
}

if (runtime === "sea") {
  console.log("2/5 preparing the Node single-executable blob");
  const cfgPath = path.join(work, "sea-config.json");
  const blob = path.join(work, "sea.blob");
  await writeFile(cfgPath, JSON.stringify(seaConfig({ main: bundled, output: blob })));
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
  run(process.execPath, [path.join(root, "node_modules", "postject", "dist", "cli.js"), ...postjectArgs({ exe, blob, platform })]);
  if (platform === "darwin") run("codesign", ["--sign", "-", exe]);
} else {
  console.log("2/5 writing toolmaster.cjs and its launchers (no Node runtime is shipped)");
  await copyFile(bundled, path.join(outDir, "toolmaster.cjs"));
  const cmd = liteCommandFor(platform);
  await writeFile(path.join(outDir, cmd.file), cmd.content, { mode: cmd.executable ? 0o755 : 0o644 });
  console.log("3/5 (skipped: no executable to build)");
}

console.log("4/5 adding engines, caches, web app and notices");
if (shipEngines) {
  for (const e of engines) {
    const src = path.join(root, "vendor", e.id);
    const cache = path.join(root, "vendor", "cache", e.id);
    const withCache = !flags.has("--no-cache") && (await exists(cache));
    if (flags.has("--no-pack")) {
      await cp(src, path.join(outDir, "vendor", e.id), { recursive: true });
      if (withCache) await cp(cache, path.join(outDir, "vendor", "cache", e.id), { recursive: true });
      continue;
    }
    for (const [from, to] of [[src, path.join(outDir, "vendor", `${e.id}.pack`)], ...(withCache ? [[cache, path.join(outDir, "vendor", "cache", `${e.id}.pack`)]] : [])]) {
      await mkdir(path.dirname(to), { recursive: true });
      const raw = await dirSize(from);
      const packed = await createPack(from, { quality });
      await writeFile(to, packed);
      console.log(`    ${path.relative(root, from)}: ${mb(raw)} -> ${mb(packed.length)} (Brotli ${quality})`);
    }
  }
}
await mkdir(path.join(outDir, "web"), { recursive: true });
await cp(path.join(root, "web", "dist"), path.join(outDir, "web", "dist"), { recursive: true });
await cp(path.join(root, "LICENSE"), path.join(outDir, "LICENSE"));
await writeFile(path.join(outDir, "THIRD-PARTY-NOTICES.txt"), noticesText({ engines, packages, runtime }));
const launcher = launcherFor(platform, runtime);
await writeFile(path.join(outDir, launcher.file), launcher.content, { mode: launcher.executable ? 0o755 : 0o644 });
await writeFile(path.join(outDir, "READ-ME-FIRST.txt"), readmeText({ toolIds, runtime, enginesBundled: shipEngines, needsEngines: engines.length > 0, launcher: launcher.file, platform }));

console.log("5/5 done");
await rm(path.join(root, "dist", ".build"), { recursive: true, force: true });
if (flags.has("--zip")) {
  const zip = `${outDir}.zip`;
  await rm(zip, { force: true });
  if (platform === "darwin") run("ditto", ["-c", "-k", "--keepParent", outDir, zip]);
  // Git Bash puts GNU tar first on PATH (it cannot make zips and mistakes "D:" for a host), so use PowerShell on Windows.
  else if (platform === "win32") run("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${outDir}' -DestinationPath '${zip}' -Force`]);
  else run("zip", ["-9qr", zip, path.basename(outDir)], { cwd: path.dirname(outDir) });
  console.log(`zip: ${zip} (${mb((await stat(zip)).size)})`);
}
console.log(`portable folder: ${outDir}`);
console.log(`${runtime === "sea" ? `executable: ${mb((await stat(exe)).size)}, ` : ""}total folder: ${mb(await dirSize(outDir))}`);

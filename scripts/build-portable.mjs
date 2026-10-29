#!/usr/bin/env node
// Builds a portable folder: single-file Node SEA launcher (UI + CLI) with only the chosen tools,
// their engines (+ warmed caches) and the web app.
//   npm run package -- [--tools all|latex-to-pdf,latex-to-docx] [--no-cache] [--zip] [--rebuild-web]
import { spawnSync } from "node:child_process";
import { cp, mkdir, rm, writeFile, chmod, copyFile, stat, access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { discoverTools } from "../core/registry.mjs";
import { packageName, bundleName, exeName, launcherFor, parseToolsArg, entrySource, noticesText, seaConfig, postjectArgs } from "./build-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = new Set(args);
const toolsArg = args.includes("--tools") ? args[args.indexOf("--tools") + 1] : undefined;
const { platform, arch } = process;

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

const toolsDir = path.join(root, "tools");
const allTools = await discoverTools(toolsDir);
const available = allTools.map((t) => t.manifest.id);
const toolIds = parseToolsArg(toolsArg, available);
const chosen = allTools.filter((t) => toolIds.includes(t.manifest.id));
const manifests = chosen.map((t) => t.manifest);
const engines = [...new Map(manifests.flatMap((m) => m.engines ?? []).map((e) => [e.id, e])).values()];

const bundle = bundleName(toolIds, available);
const name = packageName(bundle, platform, arch);
const outDir = path.join(root, "dist", name);
const work = path.join(root, "dist", ".build", name);
const exe = path.join(outDir, exeName(platform));

for (const e of engines) {
  if (!(await exists(path.join(root, "vendor", e.id, platform === "win32" && !e.binary.endsWith(".exe") ? `${e.binary}.exe` : e.binary)))) {
    throw new Error(`Engine "${e.id}" is missing. Run \`node bin/toolmaster.mjs install ${toolIds.join(" ")}\` first.`);
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

console.log(`Packaging "${bundle}" (${toolIds.join(", ")}) for ${platform}/${arch}`);
console.log("1/5 bundling the core and the chosen tools into one CommonJS file");
const entry = path.join(work, "entry.mjs");
await writeFile(entry, entrySource({ coreDir: path.join(root, "core"), toolsDir, toolIds }));
const bundled = path.join(work, "bundle.cjs");
await build({
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
});

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

console.log("4/5 copying engines, caches, web app and notices");
for (const e of engines) {
  await cp(path.join(root, "vendor", e.id), path.join(outDir, "vendor", e.id), { recursive: true });
  const cache = path.join(root, "vendor", "cache", e.id);
  if (!flags.has("--no-cache") && (await exists(cache))) await cp(cache, path.join(outDir, "vendor", "cache", e.id), { recursive: true });
}
await mkdir(path.join(outDir, "web"), { recursive: true });
await cp(path.join(root, "web", "dist"), path.join(outDir, "web", "dist"), { recursive: true });
await cp(path.join(root, "LICENSE"), path.join(outDir, "LICENSE"));
await writeFile(path.join(outDir, "THIRD-PARTY-NOTICES.txt"), noticesText(manifests));
const launcher = launcherFor(platform);
await writeFile(path.join(outDir, launcher.file), launcher.content, { mode: launcher.executable ? 0o755 : 0o644 });
const bin = `./${exeName(platform)}`;
await writeFile(
  path.join(outDir, "READ-ME-FIRST.txt"),
  [
    `ToolMaster (portable) - tools in this folder: ${toolIds.join(", ")}`,
    "",
    `Double-click ${launcher.file} (or run ${bin} ui). Your browser opens the menu of tools.`,
    `Run ${bin} in a terminal for an interactive menu, or use it from scripts:`,
    `  ${bin} list`,
    `  ${bin} ${toolIds[0]} -i input -o output --json`,
    "Everything runs locally; nothing is uploaded. Some engines download packages on first use (set TOOLMASTER_OFFLINE=1 to forbid that).",
    "macOS blocks files downloaded from the internet: run `xattr -dr com.apple.quarantine .` in this folder once.",
    "Licences of the bundled engines: THIRD-PARTY-NOTICES.txt",
    "",
  ].join("\n"),
);

console.log("5/5 done");
await rm(path.join(root, "dist", ".build"), { recursive: true, force: true });
if (flags.has("--zip")) {
  const zip = path.join(root, "dist", `${name}.zip`);
  await rm(zip, { force: true });
  if (platform === "darwin") run("ditto", ["-c", "-k", "--keepParent", outDir, zip]);
  else if (platform === "win32") run("tar", ["-a", "-c", "-f", zip, "-C", path.join(root, "dist"), name]);
  else run("zip", ["-9qr", zip, name], { cwd: path.join(root, "dist") });
  console.log(`zip: ${zip} (${mb((await stat(zip)).size)})`);
}
console.log(`portable folder: ${outDir}`);
console.log(`executable: ${mb((await stat(exe)).size)}, total folder: ${mb(await dirSize(outDir))}`);

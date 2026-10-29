export const SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

/** `all` when every available tool is included, otherwise the ids joined with "+". */
export const bundleName = (ids, available) => (ids.length === available.length ? "all" : [...ids].sort().join("+"));

/**
 * Download folder name. `sea` bundles carry their own Node runtime (one executable, any machine); `node` ("lite")
 * bundles need Node 22.13+ installed and are far smaller. A lite bundle with no engines is the same on every OS.
 */
export function packageName(bundle, platform, arch, { runtime = "sea", portable = false } = {}) {
  if (runtime === "node") return portable ? `ToolMaster-${bundle}-lite` : `ToolMaster-${bundle}-lite-${platform}-${arch}`;
  return `ToolMaster-${bundle}-${platform}-${arch}`;
}
export const exeName = (platform) => (platform === "win32" ? "toolmaster.exe" : "toolmaster");

/** "all" or a comma list of tool ids; unknown ids are an error so typos never produce a silently smaller package. */
export function parseToolsArg(arg, available) {
  if (!arg || arg === "all") return [...available];
  const ids = [...new Set(arg.split(",").map((s) => s.trim()).filter(Boolean))];
  const unknown = ids.filter((id) => !available.includes(id));
  if (ids.length === 0 || unknown.length) throw new Error(`Unknown tool(s): ${unknown.join(", ") || "(none given)"}. Available: ${available.join(", ")}`);
  return ids;
}

/** Double-click launcher for the web app. */
export function launcherFor(platform, runtime = "sea") {
  const run = runtime === "node" ? 'node "$(dirname "$0")/toolmaster.cjs" ui' : "exec ./toolmaster ui";
  if (platform === "win32") {
    return { file: "ToolMaster.bat", executable: false, content: `@echo off\r\ncd /d "%~dp0"\r\n${runtime === "node" ? 'node "%~dp0toolmaster.cjs" ui' : '"%~dp0toolmaster.exe" ui'}\r\n` };
  }
  const content = `#!/bin/sh\ncd "$(dirname "$0")" || exit 1\n${runtime === "node" ? `${NODE_CHECK}${run}\n` : `${run}\n`}`;
  return { file: platform === "darwin" ? "ToolMaster.command" : "ToolMaster.sh", executable: true, content };
}

const NODE_CHECK = 'command -v node >/dev/null 2>&1 || { echo "ToolMaster (lite) needs Node.js 22.13 or newer: https://nodejs.org"; exit 1; }\n';

/** Command-line entry for lite bundles (SEA bundles are themselves the command). */
export function liteCommandFor(platform) {
  if (platform === "win32") return { file: "toolmaster.cmd", executable: false, content: '@echo off\r\nnode "%~dp0toolmaster.cjs" %*\r\n' };
  return { file: "toolmaster", executable: true, content: `#!/bin/sh\n${NODE_CHECK}exec node "$(dirname "$0")/toolmaster.cjs" "$@"\n` };
}

/** Source of the generated bundle entry: only the chosen tools and the engines they name are imported, so the rest never ship. */
export function entrySource({ coreDir, toolsDir, enginesDir, toolIds, engineIds = [] }) {
  const imp = (p) => JSON.stringify(p.replaceAll("\\", "/"));
  return [
    `import { main } from ${imp(`${coreDir}/portable.mjs`)};`,
    `import { finish } from ${imp(`${coreDir}/cli/main.mjs`)};`,
    ...toolIds.map((id, i) => `import tool${i} from ${imp(`${toolsDir}/${id}/tool.mjs`)};`),
    ...engineIds.map((id, i) => `import engine${i} from ${imp(`${enginesDir}/${id}.mjs`)};`),
    `const tools = [${toolIds.map((_, i) => `tool${i}`).join(", ")}];`,
    `const engines = [${engineIds.map((_, i) => `engine${i}`).join(", ")}];`,
    "main(process.argv.slice(2), { tools, engines }).then(finish, (err) => {",
    '  console.error(`error: ${err?.message ?? "unexpected failure"}`);',
    "  process.exit(1);",
    "});",
    "",
  ].join("\n");
}

/** Package directories (`.../node_modules/<name>`) that esbuild pulled into the bundle, from its metafile input paths. */
export function bundledPackageDirs(inputPaths) {
  const dirs = new Set();
  for (const p of inputPaths) {
    const norm = p.replaceAll("\\", "/");
    const at = norm.lastIndexOf("node_modules/");
    if (at < 0) continue;
    const [first, second] = norm.slice(at + "node_modules/".length).split("/");
    dirs.add(`${norm.slice(0, at)}node_modules/${first.startsWith("@") ? `${first}/${second}` : first}`);
  }
  return [...dirs].sort();
}

/** Licence notice for every bundled engine and JavaScript package (some engines are GPL, so the source location must be stated). */
export function noticesText({ engines = [], packages = [], runtime = "sea" } = {}) {
  const unique = new Map();
  for (const e of engines) if (!unique.has(e.id)) unique.set(e.id, e);
  return [
    "Third-party software shipped in this folder",
    "",
    "ToolMaster itself is MIT licensed (see LICENSE).",
    ...(unique.size
      ? ["", "It runs these separate programs, unmodified:", "", ...[...unique.values()].map((e) => `- ${e.id}: ${e.license ?? "see homepage"}. Source and licence: ${e.homepage ?? "n/a"}`)]
      : []),
    ...(runtime === "sea" ? ["", "- Node.js (the launcher runtime): MIT, https://nodejs.org"] : []),
    ...(packages.length
      ? ["", "It contains these JavaScript packages (bundled into the program):", "", ...packages.map((p) => `- ${p.name} ${p.version}: ${p.license}`), "", ...packages.flatMap((p) => ["-".repeat(72), `${p.name} ${p.version} (${p.license})`, "", p.text?.trim() || "(no licence file shipped with the package; see its homepage)", ""])]
      : []),
    "",
  ].join("\n");
}

/** READ-ME-FIRST.txt for a bundle. */
export function readmeText({ toolIds, runtime, enginesBundled, needsEngines = true, launcher, platform }) {
  const bin = runtime === "node" ? (platform === "win32" ? "toolmaster.cmd" : "./toolmaster") : `./${exeName(platform)}`;
  return [
    `ToolMaster (portable) - tools in this folder: ${toolIds.join(", ")}`,
    "",
    `Double-click ${launcher} (or run ${bin} ui). Your browser opens the menu of tools.`,
    `Run ${bin} in a terminal for an interactive menu, or use it from scripts and AI agents:`,
    `  ${bin} list`,
    `  ${bin} ${toolIds[0]} -i input -o output --json`,
    `  ${bin} mcp          (serves every tool to AI clients over MCP)`,
    "Everything runs locally; nothing is uploaded.",
    ...(runtime === "node" ? ["", "This is the lite download: it needs Node.js 22.13 or newer (https://nodejs.org)."] : []),
    ...(!needsEngines ? [] : enginesBundled ? ["", "Engines are stored compressed and unpack themselves on first use (about a second)."] : ["", `Engines are not bundled: run \`${bin} install\` once (checksum-verified downloads).`]),
    ...(needsEngines ? ["Some engines download packages on first use (set TOOLMASTER_OFFLINE=1 to forbid that)."] : []),
    ...(platform === "darwin" ? ["macOS blocks files downloaded from the internet: run `xattr -dr com.apple.quarantine .` in this folder once."] : []),
    "Licences of everything bundled: THIRD-PARTY-NOTICES.txt",
    "",
  ].join("\n");
}

export const seaConfig = ({ main, output }) => ({ main, output, disableExperimentalSEAWarning: true });

export function postjectArgs({ exe, blob, platform }) {
  const args = [exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", SENTINEL];
  if (platform === "darwin") args.push("--macho-segment-name", "NODE_SEA");
  return args;
}

/** Pack compression level: slow-and-small for releases, quick for local builds, or whatever `--pack-quality` says. */
export function packQuality({ explicit, zip }) {
  if (explicit !== undefined) {
    const n = Number(explicit);
    if (!Number.isInteger(n) || n < 0 || n > 11) throw new Error("--pack-quality must be a whole number from 0 to 11");
    return n;
  }
  return zip ? 11 : 7;
}

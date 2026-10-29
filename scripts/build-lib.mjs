export const SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

/** `all` when every available tool is included, otherwise the ids joined with "+". */
export const bundleName = (ids, available) => (ids.length === available.length ? "all" : [...ids].sort().join("+"));
export const packageName = (bundle, platform, arch) => `ToolMaster-${bundle}-${platform}-${arch}`;
export const exeName = (platform) => (platform === "win32" ? "toolmaster.exe" : "toolmaster");

/** "all" or a comma list of tool ids; unknown ids are an error so typos never produce a silently smaller package. */
export function parseToolsArg(arg, available) {
  if (!arg || arg === "all") return [...available];
  const ids = [...new Set(arg.split(",").map((s) => s.trim()).filter(Boolean))];
  const unknown = ids.filter((id) => !available.includes(id));
  if (ids.length === 0 || unknown.length) throw new Error(`Unknown tool(s): ${unknown.join(", ") || "(none given)"}. Available: ${available.join(", ")}`);
  return ids;
}

export function launcherFor(platform) {
  if (platform === "win32") {
    return { file: "ToolMaster.bat", executable: false, content: '@echo off\r\ncd /d "%~dp0"\r\n"%~dp0toolmaster.exe" ui\r\n' };
  }
  const content = '#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec ./toolmaster ui\n';
  return { file: platform === "darwin" ? "ToolMaster.command" : "ToolMaster.sh", executable: true, content };
}

/** Source of the generated bundle entry: only the chosen tools are imported, so the others never ship. */
export function entrySource({ coreDir, toolsDir, toolIds }) {
  const imp = (p) => JSON.stringify(p.replaceAll("\\", "/"));
  return [
    `import { main } from ${imp(`${coreDir}/portable.mjs`)};`,
    `import { finish } from ${imp(`${coreDir}/cli/main.mjs`)};`,
    ...toolIds.map((id, i) => `import tool${i} from ${imp(`${toolsDir}/${id}/tool.mjs`)};`),
    `const tools = [${toolIds.map((_, i) => `tool${i}`).join(", ")}];`,
    "main(process.argv.slice(2), { tools }).then(finish, (err) => {",
    '  console.error(`error: ${err?.message ?? "unexpected failure"}`);',
    "  process.exit(1);",
    "});",
    "",
  ].join("\n");
}

/** Licence notice for every bundled engine (some are GPL, so the source location must be stated). */
export function noticesText(manifests) {
  const engines = new Map();
  for (const e of manifests.flatMap((m) => m.engines ?? [])) if (!engines.has(e.id)) engines.set(e.id, e);
  return [
    "Third-party software shipped in this folder",
    "",
    "ToolMaster itself is MIT licensed (see LICENSE). It runs these separate programs, unmodified:",
    "",
    ...[...engines.values()].map((e) => `- ${e.id}: ${e.license ?? "see homepage"}. Source and licence: ${e.homepage ?? "n/a"}`),
    "- Node.js (the launcher runtime): MIT, https://nodejs.org",
    "",
  ].join("\n");
}

export const seaConfig = ({ main, output }) => ({ main, output, disableExperimentalSEAWarning: true });

export function postjectArgs({ exe, blob, platform }) {
  const args = [exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", SENTINEL];
  if (platform === "darwin") args.push("--macho-segment-name", "NODE_SEA");
  return args;
}

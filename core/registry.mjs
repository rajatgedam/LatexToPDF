import { readdir, access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ToolMasterError } from "./errors.mjs";

/** Holds validated tools by id; this is all the rest of the core knows about tools. */
export function createRegistry(tools) {
  const byId = new Map();
  for (const tool of tools) {
    const id = tool?.manifest?.id;
    if (!id) throw new ToolMasterError("TOOL_INVALID", "A tool without a manifest id cannot be registered");
    if (byId.has(id)) throw new ToolMasterError("TOOL_INVALID", `Duplicate tool id "${id}"`);
    byId.set(id, tool);
  }
  const sorted = [...byId.values()].sort((a, b) => a.manifest.category.localeCompare(b.manifest.category) || a.manifest.name.localeCompare(b.manifest.name));
  return {
    list: () => sorted,
    ids: () => sorted.map((t) => t.manifest.id),
    has: (id) => byId.has(id),
    get(id) {
      const tool = byId.get(id);
      if (!tool) throw new ToolMasterError("TOOL_NOT_FOUND", `Unknown tool "${id}". Run \`toolmaster list\` to see what is installed.`);
      return tool;
    },
  };
}

/** Load `<toolsDir>/<id>/tool.mjs` for every folder present (optionally only some ids). Delete a folder to drop a tool. */
export async function discoverTools(toolsDir, { only = null } = {}) {
  const dirs = await readdir(toolsDir, { withFileTypes: true }).catch(() => []);
  const tools = [];
  for (const d of dirs.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    if (only && !only.includes(d.name)) continue;
    const entry = path.join(toolsDir, d.name, "tool.mjs");
    if (!(await access(entry).then(() => true, () => false))) continue;
    const tool = (await import(pathToFileURL(entry).href)).default;
    if (tool?.manifest?.id !== d.name) throw new ToolMasterError("TOOL_INVALID", `Tool folder "${d.name}" must declare id "${d.name}"`);
    tools.push(tool);
  }
  const missing = (only ?? []).filter((id) => !tools.some((t) => t.manifest.id === id));
  if (missing.length) throw new ToolMasterError("TOOL_NOT_FOUND", `Requested tool(s) not available: ${missing.join(", ")}`);
  return tools;
}

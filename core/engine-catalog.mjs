import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ToolMasterError } from "./errors.mjs";
import { validateEngineSpec } from "./manifest.mjs";

/**
 * The shared list of external programs. A tool names the engines it needs by id (`engines: ["pandoc"]`),
 * so two tools that use Pandoc share one download, one pinned checksum and one licence notice.
 */
export function createEngineCatalog(specs = []) {
  const byId = new Map();
  for (const spec of specs) {
    validateEngineSpec(spec, "catalog engine");
    if (byId.has(spec.id)) throw new ToolMasterError("TOOL_INVALID", `Duplicate engine id "${spec.id}"`);
    byId.set(spec.id, spec);
  }
  const catalog = {
    ids: () => [...byId.keys()],
    list: () => [...byId.values()],
    get(id) {
      const spec = byId.get(id);
      if (!spec) throw new ToolMasterError("TOOL_INVALID", `Unknown engine "${id}". Add engines/${id}.mjs to the catalog.`);
      return spec;
    },
    /** Engine specs a manifest needs: catalog ids are looked up, inline spec objects are used as given. */
    forManifest: (manifest) => (manifest.engines ?? []).map((e) => (typeof e === "string" ? catalog.get(e) : e)),
    /** Unique engine specs across several manifests (what an install, a bundle or a notice file needs). */
    forManifests: (manifests) => [...new Map(manifests.flatMap((m) => catalog.forManifest(m)).map((e) => [e.id, e])).values()],
  };
  return catalog;
}

/** Load `<dir>/<id>.mjs` (default export = engine spec) for every engine present. */
export async function discoverEngines(dir) {
  const files = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => e.isFile() && e.name.endsWith(".mjs"));
  const specs = [];
  for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
    const spec = (await import(pathToFileURL(path.join(dir, f.name)).href)).default;
    if (spec?.id !== f.name.slice(0, -4)) throw new ToolMasterError("TOOL_INVALID", `Engine file "${f.name}" must export a spec with id "${f.name.slice(0, -4)}"`);
    specs.push(spec);
  }
  return specs;
}

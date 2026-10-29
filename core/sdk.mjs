import { validateManifest } from "./manifest.mjs";
import { ToolMasterError } from "./errors.mjs";

export { ToolMasterError };

/**
 * The only core module a tool may import. A tool is `{ manifest, run, preview?, warmup? }`:
 *   run(ctx, { input, options }) -> { data: Buffer, meta?, warnings? }
 *   preview(ctx, { input, options }) -> { data: Buffer, contentType }   (only if manifest.preview === "html")
 *   warmup(ctx) -> Promise<void>   (optional: prime caches so the tool also works offline)
 * `ctx` offers: config, signal, timeoutMs, limits, engine(id), exec(opts), cacheDir(name).
 */
export function defineTool(def) {
  if (!def || typeof def.run !== "function") throw new ToolMasterError("TOOL_INVALID", "A tool must provide run(ctx, request)");
  validateManifest(def.manifest);
  if (def.manifest.preview === "html" && typeof def.preview !== "function") {
    throw new ToolMasterError("TOOL_INVALID", `Tool "${def.manifest.id}" declares an html preview but has no preview()`);
  }
  return Object.freeze({ ...def, manifest: Object.freeze(def.manifest) });
}

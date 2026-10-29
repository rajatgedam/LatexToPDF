import { validateManifest } from "./manifest.mjs";
import { ToolMasterError } from "./errors.mjs";

export { ToolMasterError };

/**
 * The only core module a tool may import. A tool is `{ manifest, run, preview?, warmup?, workers? }`:
 *   run(ctx, { input, options }) -> { data: Buffer, meta?, warnings? }
 *   preview(ctx, { input, options }) -> { data: Buffer, contentType }   (only if manifest.preview === "html")
 *   warmup(ctx) -> Promise<void>   (optional: prime caches so the tool also works offline)
 *   workers: { [job]: async ({ dir }) => result }   (optional: code that parses untrusted files; see ctx.isolate)
 * `ctx` offers:
 *   config, signal, timeoutMs, limits
 *   exec({ engine, ... })      run a catalog engine (Pandoc, Tectonic, ...) in a temp dir, scrubbed env, timeout, sandbox
 *   isolate({ job, ... })      run `workers[job]` in a separate, sandboxed copy of this program (for pure-JS parsers)
 *   engine(id), cacheDir(name) -> Promise<string>
 */
export function defineTool(def) {
  if (!def || typeof def.run !== "function") throw new ToolMasterError("TOOL_INVALID", "A tool must provide run(ctx, request)");
  validateManifest(def.manifest);
  if (def.manifest.preview === "html" && typeof def.preview !== "function") {
    throw new ToolMasterError("TOOL_INVALID", `Tool "${def.manifest.id}" declares an html preview but has no preview()`);
  }
  if (def.workers !== undefined && (def.workers === null || typeof def.workers !== "object" || !Object.values(def.workers).every((f) => typeof f === "function"))) {
    throw new ToolMasterError("TOOL_INVALID", `Tool "${def.manifest.id}": workers must be an object of functions`);
  }
  return Object.freeze({ ...def, manifest: Object.freeze(def.manifest) });
}

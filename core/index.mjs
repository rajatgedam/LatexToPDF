import path from "node:path";
import { loadConfig, SOURCE_ROOT } from "./config.mjs";
import { discoverTools, createRegistry } from "./registry.mjs";
import { createEngineCatalog, discoverEngines } from "./engine-catalog.mjs";
import { createRunner } from "./runner.mjs";

export { ToolMasterError, ERROR_CODES } from "./errors.mjs";
export { defineTool } from "./sdk.mjs";
export { loadConfig } from "./config.mjs";

/**
 * Build a ready-to-use instance. Tools are discovered from `<projectRoot>/tools/*` and engine specs from the program's own
 * `engines/*` unless `tools` / `engines` are given (the single-file builds pass the ones they bundle). TOOLMASTER_TOOLS narrows the tool set.
 */
export async function createToolMaster({ env = process.env, projectRoot, tools, toolsDir, engines, enginesDir, self } = {}) {
  const config = loadConfig(env, { ...(projectRoot ? { projectRoot } : {}), ...(self ? { self } : {}) });
  const only = config.enabledTools;
  const list = tools ? (only ? tools.filter((t) => only.includes(t.manifest.id)) : tools) : await discoverTools(toolsDir ?? path.join(config.projectRoot, "tools"), { only });
  const catalog = createEngineCatalog(engines ?? (await discoverEngines(enginesDir ?? path.join(SOURCE_ROOT, "engines"))));
  const registry = createRegistry(list);
  for (const tool of registry.list()) catalog.forManifest(tool.manifest);
  const runner = createRunner({ config, registry, engines: catalog });
  return { config, registry, engines: catalog, runner, run: runner.run, runToFile: runner.runToFile };
}

let shared;
const instance = () => (shared ??= createToolMaster());

/** `run("latex-to-pdf", { input: "...", options: {} })` -> { data, contentType, meta, warnings, durationMs } */
export const run = async (toolId, request) => (await instance()).runner.run(toolId, request);

/** `runToFile({ tool, input|source, output, options, mkdir })` -> { outputPath, bytes, meta, warnings, durationMs } */
export const runToFile = async (options) => (await instance()).runner.runToFile(options);

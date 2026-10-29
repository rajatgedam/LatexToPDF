import path from "node:path";
import { loadConfig } from "./config.mjs";
import { discoverTools, createRegistry } from "./registry.mjs";
import { createRunner } from "./runner.mjs";

export { ToolMasterError, ERROR_CODES } from "./errors.mjs";
export { defineTool } from "./sdk.mjs";
export { loadConfig } from "./config.mjs";

/**
 * Build a ready-to-use instance. Tools are discovered from `<projectRoot>/tools/*` unless `tools` is given
 * (the single-file executable passes its bundled tools). TOOLMASTER_TOOLS narrows the set either way.
 */
export async function createToolMaster({ env = process.env, projectRoot, tools, toolsDir } = {}) {
  const config = loadConfig(env, projectRoot ? { projectRoot } : {});
  const only = config.enabledTools;
  const list = tools ? (only ? tools.filter((t) => only.includes(t.manifest.id)) : tools) : await discoverTools(toolsDir ?? path.join(config.projectRoot, "tools"), { only });
  const registry = createRegistry(list);
  const runner = createRunner({ config, registry });
  return { config, registry, runner, run: runner.run, runToFile: runner.runToFile };
}

let shared;
const instance = () => (shared ??= createToolMaster());

/** `run("latex-to-pdf", { input: "...", options: {} })` -> { data, contentType, meta, warnings, durationMs } */
export const run = async (toolId, request) => (await instance()).runner.run(toolId, request);

/** `runToFile({ tool, input|source, output, options, mkdir })` -> { outputPath, bytes, meta, warnings, durationMs } */
export const runToFile = async (options) => (await instance()).runner.runToFile(options);

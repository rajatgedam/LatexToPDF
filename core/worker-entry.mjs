// Entry used when ToolMaster runs from source: `node core/worker-entry.mjs <tool> <job>` (the single-file builds
// answer the same request through their own entry). It loads only the one tool it was asked to run.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTools } from "./registry.mjs";
import { runWorker } from "./worker.mjs";

const [toolId, job] = process.argv.slice(2);
const toolsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tools");
const tools = toolId && /^[a-z][a-z0-9-]*$/.test(toolId) ? await discoverTools(toolsDir, { only: [toolId] }).catch(() => []) : [];
// Exit explicitly: a parser library must not be able to keep the worker alive with a stray timer.
process.exit(await runWorker({ tools, toolId, job }));

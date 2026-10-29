import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ToolMasterError } from "./errors.mjs";

const MAX_MESSAGE = 300;

/**
 * Child side of `ctx.isolate`: run `tool.workers[job]({ dir })` inside the work folder and write `result.json`.
 * A handled failure is reported as `{ error: { code, message } }` with exit code 0 so the parent can map it precisely;
 * a crash, out-of-memory kill or timeout shows up as a non-zero exit instead.
 */
export async function runWorker({ tools, toolId, job, dir = process.cwd() }) {
  const workers = tools.find((t) => t.manifest.id === toolId)?.workers;
  const worker = workers && Object.hasOwn(workers, job) ? workers[job] : undefined;
  if (typeof worker !== "function") {
    process.stderr.write(`error: unknown worker ${toolId}/${job}\n`);
    return 2;
  }
  let body;
  try {
    body = { result: (await worker({ dir })) ?? {} };
  } catch (err) {
    const known = err instanceof ToolMasterError;
    body = { error: { code: known ? err.code : "TOOL_FAILED", message: String(known ? err.message : err?.message ?? "worker failed").slice(0, MAX_MESSAGE) } };
  }
  await writeFile(path.join(dir, "result.json"), JSON.stringify(body));
  return 0;
}

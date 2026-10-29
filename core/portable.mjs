import path from "node:path";
import { runCli } from "./cli/index.mjs";

export const portableRoot = (execPath) => path.dirname(execPath);

/** Entry for the single-file executable: tools are bundled in; engines, caches and the web UI live next to the binary. */
export async function main(argv, { tools, execPath = process.execPath, env = process.env } = {}) {
  return runCli(argv, { env, tools, projectRoot: portableRoot(execPath) });
}

import path from "node:path";
import { isSea } from "node:sea";
import { runCli } from "./cli/index.mjs";
import { runWorker } from "./worker.mjs";

/** Where engines, caches and the web UI live: next to the executable, or next to the bundle script when run with `node`. */
export const portableRoot = ({ sea, execPath, entry }) => path.dirname(sea ? execPath : entry);

/** How a worker is started: the executable itself, or `node <bundle>`; the second form may also read its own folder. */
export const selfFor = ({ sea, execPath, entry }) =>
  sea ? { command: execPath, args: ["__worker"], ro: [] } : { command: execPath, args: [entry, "__worker"], ro: [path.dirname(entry)] };

/**
 * Entry for the single-file builds (`toolmaster` executable or `node toolmaster.cjs`): tools and engine specs are bundled in;
 * engines, caches and the web UI live next to the entry. `toolmaster __worker <tool> <job>` is the hidden child side of `ctx.isolate`.
 */
export async function main(argv, { tools, engines, execPath = process.execPath, entry = process.argv[1], env = process.env, sea = isSea(), exit = process.exit } = {}) {
  const where = { sea, execPath, entry };
  if (argv[0] === "__worker") return exit(await runWorker({ tools, toolId: argv[1], job: argv[2] }));
  return runCli(argv, { env, tools, engines, self: selfFor(where), projectRoot: portableRoot(where) });
}

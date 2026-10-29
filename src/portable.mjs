import path from "node:path";
import { loadConfig } from "./config.mjs";
import { runCli } from "./cli.mjs";
import { launchUi } from "./server/launch.mjs";

export const USAGE_HINT = "latex2pdf [ui [--no-open]]  |  latex2pdf -i <in.tex> -o <out.pdf> [options]  (see --help)";

/** No args / `ui` -> local web UI; anything else is passed to the CLI (an optional leading `compile` is dropped). */
export function decideMode(argv) {
  const rest = argv[0] === "ui" ? argv.slice(1) : argv;
  if (rest.every((a) => a === "--no-open")) return { mode: "ui", open: !rest.includes("--no-open") };
  return { mode: "cli", args: argv[0] === "compile" ? argv.slice(1) : argv };
}

export const portableRoot = (execPath) => path.dirname(execPath);

/** Entry for the single-file executable: everything (engine, cache, web) lives next to the binary. */
export async function main(argv, { execPath = process.execPath, env = process.env } = {}) {
  const root = portableRoot(execPath);
  const config = loadConfig(env, { projectRoot: root });
  const decision = decideMode(argv);
  if (decision.mode === "cli") return runCli(decision.args, { env, projectRoot: root });

  const ui = await launchUi({ config, open: decision.open });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.once(sig, async () => {
      await ui.close();
      process.exit(0);
    });
  }
  return null;
}

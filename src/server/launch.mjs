import { spawn } from "node:child_process";
import { engineInfo } from "../engine.mjs";
import { startServer, browserCommand } from "./index.mjs";

/** Start the UI server, warn about risky setups, and optionally open the default browser. */
export async function launchUi({ config, port, open = true, log = console, spawnFn = spawn, platform = process.platform }) {
  const engine = await engineInfo(config);
  if (!engine.found) log.warn("warning: Tectonic engine not found. Run `npm run install:engine` (compiles will fail until then).");
  if (config.allowRemote) log.warn("warning: remote access enabled; only do this on a trusted network.");

  const ui = await startServer({ config, port });
  log.log(`LatexToPDF is running at ${ui.url}  (Ctrl+C to quit)`);

  if (open) {
    const { cmd, args } = browserCommand(platform, ui.url);
    spawnFn(cmd, args, { stdio: "ignore", detached: true })
      .on("error", () => log.log("Open the URL above in your browser."))
      .unref();
  }
  return ui;
}

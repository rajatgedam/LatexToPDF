import { spawn } from "node:child_process";
import { startServer, browserCommand } from "./index.mjs";

/** Start the UI server, warn about risky setups, and optionally open the default browser. */
export async function launchUi({ tm, port, open = true, log = console, spawnFn = spawn, platform = process.platform }) {
  const status = await tm.runner.status({ fresh: true });
  for (const [id, s] of Object.entries(status)) {
    if (!s.ready) log.warn(`warning: the engine for "${id}" is not installed. Run: toolmaster install ${id}`);
  }
  if (tm.config.allowRemote) log.warn("warning: remote access enabled; only do this on a trusted network.");

  const ui = await startServer({ config: tm.config, runner: tm.runner, port });
  log.log(`ToolMaster is running at ${ui.url}  (Ctrl+C to quit)`);

  if (open) {
    const { cmd, args } = browserCommand(platform, ui.url);
    spawnFn(cmd, args, { stdio: "ignore", detached: true })
      .on("error", () => log.log("Open the URL above in your browser."))
      .unref();
  }
  return ui;
}

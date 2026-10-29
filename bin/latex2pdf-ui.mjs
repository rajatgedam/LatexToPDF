#!/usr/bin/env node
import { loadConfig } from "../src/config.mjs";
import { launchUi } from "../src/server/launch.mjs";

const ui = await launchUi({ config: loadConfig(), open: !process.argv.includes("--no-open") });

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, async () => {
    await ui.close();
    process.exit(0);
  });
}

#!/usr/bin/env node
import { spawn } from "node:child_process";
import { loadConfig } from "../src/config.mjs";
import { startServer, browserCommand } from "../src/server/index.mjs";
import { engineInfo } from "../src/engine.mjs";

const noOpen = process.argv.includes("--no-open");
const config = loadConfig();
const engine = await engineInfo(config);
if (!engine.found) console.warn("warning: Tectonic engine not found. Run `npm run install:engine` (compiles will fail until then).");
if (config.allowRemote) console.warn("warning: remote access enabled; only do this on a trusted network.");

const { url, close } = await startServer({ config });
console.log(`LatexToPDF is running at ${url}  (Ctrl+C to quit)`);

if (!noOpen) {
  const { cmd, args } = browserCommand(process.platform, url);
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => console.log("Open the URL above in your browser.")).unref();
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, async () => {
    await close();
    process.exit(0);
  });
}

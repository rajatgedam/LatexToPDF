#!/usr/bin/env node
// Prints the release/Docker build matrices as JSON for GitHub Actions.
//   node scripts/plan-release.mjs [--full] [--github-output]
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTools } from "../core/registry.mjs";
import { planRelease, dockerImages } from "./plan-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tools = (await discoverTools(path.join(root, "tools"))).map((t) => ({ id: t.manifest.id, engines: (t.manifest.engines ?? []).map((e) => (typeof e === "string" ? e : e.id)) }));
const full = process.argv.includes("--full");
const plan = { include: planRelease({ tools, full }) };
const images = dockerImages(tools);

if (process.argv.includes("--github-output")) {
  appendFileSync(process.env.GITHUB_OUTPUT, `bundles=${JSON.stringify(plan)}\nimages=${JSON.stringify(images)}\ncount=${tools.length}\n`);
} else {
  console.log(JSON.stringify({ bundles: plan, images, tools: tools.length }, null, 2));
}

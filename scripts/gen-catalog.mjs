#!/usr/bin/env node
// Writes TOOLS.md (the tool catalog) from the manifests. `--check` fails if the file is out of date.
//   npm run catalog            regenerate
//   node scripts/gen-catalog.mjs --check
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createToolMaster } from "../core/index.mjs";
import { renderCatalog } from "../core/catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "TOOLS.md");
const tm = await createToolMaster({ env: {}, projectRoot: root });
const text = `${renderCatalog(tm.registry.list().map((t) => t.manifest), tm.engines).trimEnd()}\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(file, "utf8").catch(() => "");
  if (current !== text) {
    console.error("TOOLS.md is out of date. Run: npm run catalog");
    process.exit(1);
  }
  console.log("TOOLS.md is up to date");
} else {
  await writeFile(file, text);
  console.log(`wrote ${file}`);
}

#!/usr/bin/env node
// Deletes every tool folder not listed, so a slim image or checkout ships only the tools it needs.
//   node scripts/prune-tools.mjs latex-to-docx[,other] [toolsDir]
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [keepArg = "all", dirArg] = process.argv.slice(2);
const toolsDir = dirArg ? path.resolve(dirArg) : path.join(root, "tools");

if (keepArg !== "all") {
  const keep = new Set(keepArg.split(",").map((s) => s.trim()).filter(Boolean));
  const present = (await readdir(toolsDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  const unknown = [...keep].filter((id) => !present.includes(id));
  if (unknown.length) throw new Error(`Unknown tool(s): ${unknown.join(", ")}. Available: ${present.join(", ")}`);
  for (const id of present.filter((id) => !keep.has(id))) await rm(path.join(toolsDir, id), { recursive: true, force: true });
  console.log(`kept: ${[...keep].join(", ")}`);
}

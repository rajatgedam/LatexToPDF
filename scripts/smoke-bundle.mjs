#!/usr/bin/env node
// Smoke-tests a packaged bundle from the outside, the way a user would: list, convert with every tool it contains, then MCP.
//   node scripts/smoke-bundle.mjs <bundle-folder> [--expect all]
// Runs offline. Every tool needs a case below; a tool without one fails the check, so new tools cannot ship untested.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [bundleArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!bundleArg) throw new Error("usage: node scripts/smoke-bundle.mjs <bundle-folder> [--expect all]");
const dir = path.resolve(bundleArg);
const lite = existsSync(path.join(dir, "toolmaster.cjs"));
const [command, prefix] = lite ? [process.execPath, [path.join(dir, "toolmaster.cjs")]] : [path.join(dir, process.platform === "win32" ? "toolmaster.exe" : "toolmaster"), []];
const work = mkdtempSync(path.join(os.tmpdir(), "tm-smoke-"));
const env = { ...process.env, TOOLMASTER_OFFLINE: "1", TOOLMASTER_MCP_ROOTS: [work, root].join(path.delimiter) };
const fixture = path.join(root, "test", "fixtures", "sample.pdf");

const tm = (args, input) => spawnSync(command, [...prefix, ...args], { env, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024, timeout: 180_000 });
const ok = (r, what) => {
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status}): ${r.stderr || r.stdout}`.slice(0, 1500));
  return r.stdout;
};
const json = (r, what) => JSON.parse(ok(r, what));
const starts = (file, magic) => readFileSync(file).subarray(0, magic.length).toString("latin1") === magic;

const CASES = {
  "latex-to-pdf"() {
    const input = path.join(work, "in.tex");
    writeFileSync(input, ok(tm(["sample", "latex-to-pdf"]), "sample"));
    const out = path.join(work, "l2p.pdf");
    json(tm(["latex-to-pdf", "-i", input, "-o", out, "--json"]), "latex-to-pdf");
    if (!starts(out, "%PDF-")) throw new Error("latex-to-pdf did not write a PDF");
  },
  "latex-to-docx"() {
    const input = path.join(work, "in2.tex");
    writeFileSync(input, ok(tm(["sample", "latex-to-docx"]), "sample"));
    const out = path.join(work, "l2d.docx");
    json(tm(["latex-to-docx", "-i", input, "-o", out, "--json"]), "latex-to-docx");
    if (!starts(out, "PK")) throw new Error("latex-to-docx did not write a DOCX");
  },
  "pdf-pages"() {
    const out = path.join(work, "pages.pdf");
    const r = json(tm(["pdf-pages", "-i", fixture, "-o", out, "-O", "pages=3,1", "--json"]), "pdf-pages");
    if (!starts(out, "%PDF-") || r.meta.pages !== 2 || r.meta.sourcePages !== 3) throw new Error(`pdf-pages gave ${JSON.stringify(r.meta)}`);
  },
  "doc-to-markdown"() {
    const text = ok(tm(["doc-to-markdown", "-i", fixture, "-o", "-"]), "doc-to-markdown");
    if (!/fixture page 2/.test(text) || !/<!-- page 3 -->/.test(text)) throw new Error(`doc-to-markdown returned: ${text.slice(0, 200)}`);
  },
};

function mcp(expectedIds) {
  const lines = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ].map((m) => JSON.stringify(m)).join("\n");
  const replies = ok(tm(["mcp"], `${lines}\n`), "mcp").trim().split("\n").map((l) => JSON.parse(l));
  const names = replies.find((r) => r.id === 2).result.tools.map((t) => t.name).sort();
  if (JSON.stringify(names) !== JSON.stringify([...expectedIds].sort())) throw new Error(`MCP lists ${names} but the bundle has ${expectedIds}`);
}

try {
  const tools = json(tm(["list", "--json"]), "list").tools;
  const ids = tools.map((t) => t.id);
  console.log(`bundle: ${path.basename(dir)} (${lite ? "lite" : "single executable"}) tools: ${ids.join(", ")}`);
  if (process.argv.includes("--expect") && process.argv[process.argv.indexOf("--expect") + 1] === "all") {
    const all = readdirSync(path.join(root, "tools"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    if (JSON.stringify([...ids].sort()) !== JSON.stringify(all)) throw new Error(`the all bundle has ${ids} but the repository has ${all}`);
  }
  if (tools.some((t) => !t.status.ready)) throw new Error(`not ready: ${tools.filter((t) => !t.status.ready).map((t) => t.id)}`);
  for (const id of ids) {
    if (!CASES[id]) throw new Error(`no smoke case for tool "${id}": add one to scripts/smoke-bundle.mjs`);
    CASES[id]();
    json(tm(["help", id, "--json"]), `help ${id}`);
    console.log(`  ok ${id}`);
  }
  mcp(ids);
  console.log("  ok mcp");
} finally {
  rmSync(work, { recursive: true, force: true });
}

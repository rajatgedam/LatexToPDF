import { writeFile, chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Creates a fake `tectonic` executable whose behaviour is driven by %%MARKERS in the .tex input. */
export async function makeFakeEngine() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "l2p-fake-"));
  const file = path.join(dir, "tectonic");
  const script = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("Tectonic 0.17.0-fake"); process.exit(0); }
const input = args[args.length - 1];
const outdir = args[args.indexOf("--outdir") + 1];
const tex = fs.readFileSync(input, "utf8");
const pdf = (body) => fs.writeFileSync(path.join(outdir, "main.pdf"), "%PDF-1.5\\n" + body);
if (tex.includes("%%SLEEP")) setTimeout(() => {}, 60000);
else if (tex.includes("%%FAIL")) { console.log("! Undefined control sequence in " + process.cwd()); console.error("error: halted on potentially-recoverable error"); process.exit(1); }
else if (tex.includes("%%NOPDF")) process.exit(0);
else if (tex.includes("%%BADPDF")) { fs.writeFileSync(path.join(outdir, "main.pdf"), "not a pdf"); }
else if (tex.includes("%%BIG")) pdf("x".repeat(2000));
else if (tex.includes("%%ENV")) pdf(JSON.stringify(process.env));
else if (tex.includes("%%ARGS")) pdf(JSON.stringify({ args, cwd: process.cwd() }));
else if (tex.includes("%%FLOOD")) { process.stdout.write("y".repeat(2_000_000)); process.stderr.write("warning: noisy\\n"); pdf("ok"); }
else if (tex.includes("%%WARN")) { console.error("warning: Overfull hbox"); pdf("ok"); }
else pdf("fake");
`;
  await writeFile(file, script, { mode: 0o755 });
  await chmod(file, 0o755);
  return { path: file, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export const TEX = (body = "hello") => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;

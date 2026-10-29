import { writeFile, chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Fake `pandoc`: behaviour is driven by %%MARKERS in the input file; writes the file named after `-o`. */
export async function makeFakePandoc() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tm-fakepandoc-"));
  const file = path.join(dir, "pandoc");
  const script = `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("pandoc 3.13-fake"); process.exit(0); }
const out = args[args.indexOf("-o") + 1];
const input = fs.readFileSync(args[args.length - 1], "utf8");
const isDocx = out.endsWith(".docx");
const write = (body) => fs.writeFileSync(out, body);
if (input.includes("%%FAIL")) { console.error('Error at "input.txt" (line 1, column 1):\\nunexpected input'); process.exit(64); }
else if (input.includes("%%NOOUT")) process.exit(0);
else if (input.includes("%%SLEEP")) setTimeout(() => {}, 60000);
else if (input.includes("%%BADDOCX")) write("nope");
else if (input.includes("%%WARN")) { console.error("[WARNING] Could not convert something"); write(isDocx ? "PK\\u0003\\u0004fake" : "<p>fake</p>"); }
else if (input.includes("%%ARGS")) write(isDocx ? "PK" + JSON.stringify({ args, input }) : "<pre>" + JSON.stringify({ args, input }) + "</pre>");
else write(isDocx ? "PK\\u0003\\u0004fake" : "<p>fake</p>");
`;
  await writeFile(file, script, { mode: 0o755 });
  await chmod(file, 0o755);
  return { path: file, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

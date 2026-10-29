import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageName, exeName } from "../../../scripts/build-lib.mjs";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const folderFor = (bundle) => path.join(root, "dist", packageName(bundle, process.platform, process.arch));
const has = (p) => access(p).then(() => true, () => false);
const cleanEnv = { HOME: os.homedir(), PATH: "/usr/bin:/bin" };
const toolIds = async (exe) => JSON.parse((await run(exe, ["list", "--json"], { env: cleanEnv })).stdout).tools.map((t) => t.id).sort();

const all = folderFor("all");
const only = folderFor("latex-to-docx");
const allExe = path.join(all, exeName(process.platform));
const onlyExe = path.join(only, exeName(process.platform));
const skipAll = (await has(allExe)) ? false : "bundle not built (npm run package)";
const skipOnly = (await has(onlyExe)) ? false : "single-tool bundle not built (npm run package -- --tools latex-to-docx)";

let dir;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tm-portable-"));
});
after(() => rm(dir, { recursive: true, force: true }));

test("all-tools bundle runs without Node on PATH and lists both tools as ready", { skip: skipAll }, async () => {
  const { stdout } = await run(allExe, ["doctor", "--json"], { env: cleanEnv });
  assert.equal(JSON.parse(stdout).ok, true);
  assert.deepEqual(await toolIds(allExe), ["latex-to-docx", "latex-to-pdf"]);
});

test("all-tools bundle converts with both tools, offline", { skip: skipAll }, async () => {
  const env = { ...cleanEnv, TOOLMASTER_OFFLINE: "1" };
  for (const [id, ext] of [["latex-to-pdf", "pdf"], ["latex-to-docx", "docx"]]) {
    const sample = path.join(dir, `${id}.txt`);
    const { stdout: text } = await run(allExe, ["sample", id], { env });
    await (await import("node:fs/promises")).writeFile(sample, text);
    const { stdout } = await run(allExe, [id, "-i", sample, "-o", path.join(dir, `${id}.${ext}`), "--json"], { env });
    assert.equal(JSON.parse(stdout).ok, true, id);
  }
});

test("a single-tool bundle contains only that tool and its engine", { skip: skipOnly }, async () => {
  assert.deepEqual(await toolIds(onlyExe), ["latex-to-docx"]);
  assert.equal(await has(path.join(only, "vendor", "pandoc")), true);
  assert.equal(await has(path.join(only, "vendor", "tectonic")), false);
  assert.equal(await has(path.join(only, "vendor", "cache", "tectonic")), false);
  const { stderr } = await run(onlyExe, ["latex-to-pdf", "-i", "x", "-o", "y.pdf"], { env: cleanEnv }).catch((e) => e);
  assert.match(stderr, /Unknown command or tool "latex-to-pdf"/);
});

test("licence notices are shipped next to the engines", { skip: skipOnly }, async () => {
  const { readFile } = await import("node:fs/promises");
  const notices = await readFile(path.join(only, "THIRD-PARTY-NOTICES.txt"), "utf8");
  assert.match(notices, /pandoc: GPL-2\.0-or-later/);
  assert.ok(!notices.includes("tectonic"));
});

test("UI mode serves the menu app and the tool catalog on the chosen port", { skip: skipAll }, async () => {
  const port = 5900 + Math.floor(Math.random() * 90);
  const child = spawn(allExe, ["ui", "--no-open"], { env: { ...cleanEnv, TOOLMASTER_PORT: String(port) }, stdio: "ignore" });
  try {
    let html = "";
    for (let i = 0; i < 50 && !html; i++) {
      html = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text(), () => "");
      if (!html) await new Promise((r) => setTimeout(r, 100));
    }
    assert.match(html, /<div id="root">/);
    const tools = (await (await fetch(`http://127.0.0.1:${port}/api/tools`)).json()).tools;
    assert.equal(tools.length, 2);
    assert.ok(tools.every((t) => t.status.ready));
  } finally {
    child.kill("SIGTERM");
  }
});

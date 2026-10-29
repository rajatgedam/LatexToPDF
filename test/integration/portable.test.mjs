import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageName, exeName } from "../../scripts/build-lib.mjs";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const folder = path.join(root, "dist", packageName(process.platform, process.arch));
const exe = path.join(folder, exeName(process.platform));
const built = await access(exe).then(() => true, () => false);
const opts = { skip: built ? false : "portable build not found (npm run package)" };
const cleanEnv = { HOME: os.homedir(), PATH: "/usr/bin:/bin" };

let dir;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "l2p-portable-"));
});
after(() => rm(dir, { recursive: true, force: true }));

test("executable runs without Node on PATH and finds its bundled engine", opts, async () => {
  const { stdout } = await run(exe, ["--check", "--json"], { env: cleanEnv });
  assert.equal(JSON.parse(stdout).engine.found, true);
});

test("CLI mode compiles the bundled example offline", opts, async () => {
  const output = path.join(dir, "resume.pdf");
  const { stdout } = await run(exe, ["-i", path.join(folder, "examples", "resume.tex"), "-o", output, "--json"], { env: { ...cleanEnv, LATEX2PDF_OFFLINE: "1" } });
  const j = JSON.parse(stdout);
  assert.equal(j.ok, true);
  assert.equal(j.pages, 1);
});

test("UI mode serves the web app and the API on the chosen port", opts, async () => {
  const port = 5900 + Math.floor(Math.random() * 90);
  const child = spawn(exe, ["ui", "--no-open"], { env: { ...cleanEnv, LATEX2PDF_PORT: String(port) }, stdio: "ignore" });
  try {
    let html = "";
    for (let i = 0; i < 50 && !html; i++) {
      html = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text(), () => "");
      if (!html) await new Promise((r) => setTimeout(r, 100));
    }
    assert.match(html, /<div id="root">/);
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(health.engine.found, true);
  } finally {
    child.kill("SIGTERM");
  }
});

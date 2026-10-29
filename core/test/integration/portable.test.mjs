import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageName, exeName } from "../../../scripts/build-lib.mjs";

// These tests exercise bundles built by `npm run package`; they skip when the bundle is not there.
const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const has = (p) => access(p).then(() => true, () => false);
const cleanEnv = { HOME: os.homedir(), PATH: "/usr/bin:/bin" };

const all = path.join(root, "dist", packageName("all", process.platform, process.arch));
const allExe = path.join(all, exeName(process.platform));
const lite = path.join(root, "dist", packageName("pdf-pages", process.platform, process.arch, { runtime: "node", portable: true }));
const skipAll = (await has(allExe)) ? false : "bundle not built (npm run package)";
const skipLite = (await has(path.join(lite, "toolmaster.cjs"))) ? false : "lite bundle not built (npm run package -- --tools pdf-pages --runtime node)";

const toolIds = async (cmd, pre = []) => JSON.parse((await run(cmd, [...pre, "list", "--json"], { env: cleanEnv })).stdout).tools.map((t) => t.id).sort();

test("all-tools executable runs without Node on PATH; every tool passes the smoke test offline", { skip: skipAll, timeout: 300_000 }, async () => {
  assert.deepEqual(await toolIds(allExe), ["doc-to-markdown", "latex-to-docx", "latex-to-pdf", "pdf-pages"]);
  const { stdout } = await run(process.execPath, [path.join(root, "scripts", "smoke-bundle.mjs"), all, "--expect", "all"], { env: { ...process.env } });
  assert.match(stdout, /ok mcp/);
});

test("engines ship compressed as packs and the notices name every engine and bundled library", { skip: skipAll }, async () => {
  assert.equal(await has(path.join(all, "vendor", "pandoc.pack")), true);
  assert.equal(await has(path.join(all, "vendor", "tectonic.pack")), true);
  assert.equal(await has(path.join(all, "vendor", "cache", "tectonic.pack")), true);
  const notices = await readFile(path.join(all, "THIRD-PARTY-NOTICES.txt"), "utf8");
  assert.match(notices, /pandoc: GPL-2\.0-or-later/);
  assert.match(notices, /tectonic: MIT/);
  assert.match(notices, /pdfjs-dist [\d.]+: Apache-2\.0/);
  assert.match(notices, /@cantoo\/pdf-lib [\d.]+: MIT/);
});

test("the lite pdf-pages bundle is tiny, needs no engine, and runs with plain Node", { skip: skipLite }, async () => {
  const cmd = [process.execPath, [path.join(lite, "toolmaster.cjs")]];
  assert.deepEqual(await toolIds(cmd[0], cmd[1]), ["pdf-pages"]);
  assert.equal(await has(path.join(lite, "vendor")), false);
  const notices = await readFile(path.join(lite, "THIRD-PARTY-NOTICES.txt"), "utf8");
  assert.ok(!/pandoc|tectonic|Node\.js \(the launcher/.test(notices));
  const { stdout } = await run(process.execPath, [path.join(root, "scripts", "smoke-bundle.mjs"), lite]);
  assert.match(stdout, /ok pdf-pages/);
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
    assert.equal(tools.length, 4);
    assert.ok(tools.every((t) => t.status.ready));
    const { stdout } = await run(process.execPath, [path.join(root, "scripts", "smoke-http.mjs"), `http://127.0.0.1:${port}`, "4"]);
    assert.match(stdout, /ok host check/);
  } finally {
    child.kill("SIGTERM");
  }
});

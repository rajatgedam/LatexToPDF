import { test } from "node:test";
import assert from "node:assert/strict";
import { launchUi } from "../../src/server/launch.mjs";
import { decideMode, portableRoot, USAGE_HINT } from "../../src/portable.mjs";
import { loadConfig } from "../../src/config.mjs";

const quietLog = () => {
  const lines = [];
  return { lines, log: { log: (m) => lines.push(m), warn: (m) => lines.push(`WARN ${m}`) } };
};

test("launchUi starts the server and opens the browser with the fixed command", async () => {
  const calls = [];
  const spawnFn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { on() { return this; }, unref() {} };
  };
  const { lines, log } = quietLog();
  const ui = await launchUi({ config: loadConfig({ LATEX2PDF_ENGINE: "/nonexistent" }), port: 0, log, spawnFn, platform: "darwin" });
  try {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, "open");
    assert.equal(calls[0].args[0], ui.url);
    assert.equal(calls[0].opts.stdio, "ignore");
    assert.ok(lines.some((l) => l.includes(ui.url)));
  } finally {
    await ui.close();
  }
});

test("launchUi with open=false never spawns and warns if the engine is missing", async () => {
  let spawned = false;
  const { lines, log } = quietLog();
  const ui = await launchUi({ config: loadConfig({ LATEX2PDF_ENGINE: "/nonexistent" }), port: 0, open: false, log, spawnFn: () => ((spawned = true), {}) });
  try {
    assert.equal(spawned, false);
    assert.ok(lines.some((l) => l.startsWith("WARN") && /engine/i.test(l)));
  } finally {
    await ui.close();
  }
});

test("launchUi warns loudly when remote access is enabled", async () => {
  const { lines, log } = quietLog();
  const ui = await launchUi({ config: loadConfig({ LATEX2PDF_HOST: "127.0.0.1", LATEX2PDF_ALLOW_REMOTE: "1", LATEX2PDF_ENGINE: "/nonexistent" }), port: 0, open: false, log });
  try {
    assert.ok(lines.some((l) => /remote access/i.test(l)));
  } finally {
    await ui.close();
  }
});

test("decideMode: no args or ui flags start the UI, anything else is the CLI", () => {
  assert.deepEqual(decideMode([]), { mode: "ui", open: true });
  assert.deepEqual(decideMode(["ui"]), { mode: "ui", open: true });
  assert.deepEqual(decideMode(["ui", "--no-open"]), { mode: "ui", open: false });
  assert.deepEqual(decideMode(["--no-open"]), { mode: "ui", open: false });
  assert.deepEqual(decideMode(["-i", "a.tex", "-o", "a.pdf"]), { mode: "cli", args: ["-i", "a.tex", "-o", "a.pdf"] });
  assert.deepEqual(decideMode(["compile", "-i", "a.tex", "-o", "a.pdf"]), { mode: "cli", args: ["-i", "a.tex", "-o", "a.pdf"] });
  assert.deepEqual(decideMode(["--check"]), { mode: "cli", args: ["--check"] });
  assert.deepEqual(decideMode(["--help"]), { mode: "cli", args: ["--help"] });
});

test("portableRoot is the folder holding the executable", () => {
  assert.equal(portableRoot("/Apps/LatexToPDF/latex2pdf"), "/Apps/LatexToPDF");
});

test("usage hint mentions both modes", () => {
  assert.match(USAGE_HINT, /ui/);
  assert.match(USAGE_HINT, /-i/);
});

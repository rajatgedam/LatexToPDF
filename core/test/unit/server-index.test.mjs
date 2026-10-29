import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { browserCommand, startServer } from "../../server/index.mjs";
import { launchUi } from "../../server/launch.mjs";
import { createToolMaster } from "../../index.mjs";
import { fakeTool, fakeEngineSpec } from "../../../test/helpers/fake-tool.mjs";

const make = (env = {}, tools = [fakeTool()]) => createToolMaster({ env: { TOOLMASTER_PORT: "", TOOLMASTER_SANDBOX: "off", ...env }, projectRoot: "/tmp/tm-index-test", tools });
const quietLog = () => {
  const lines = [];
  return { lines, log: { log: (m) => lines.push(m), warn: (m) => lines.push(`WARN ${m}`) } };
};

test("browserCommand uses fixed argv per platform (no shell, URL is one argument)", () => {
  assert.deepEqual(browserCommand("darwin", "http://127.0.0.1:1"), { cmd: "open", args: ["http://127.0.0.1:1"] });
  assert.deepEqual(browserCommand("linux", "http://127.0.0.1:1"), { cmd: "xdg-open", args: ["http://127.0.0.1:1"] });
  assert.deepEqual(browserCommand("win32", "http://127.0.0.1:1"), { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", "http://127.0.0.1:1"] });
});

test("browserCommand refuses anything that is not an http loopback URL", () => {
  assert.throws(() => browserCommand("darwin", "file:///etc/passwd"));
  assert.throws(() => browserCommand("darwin", "https://evil.test"));
});

test("startServer binds loopback and returns a usable url; close() stops it", async () => {
  const tm = await make();
  const s = await startServer({ config: tm.config, runner: tm.runner, port: 0 });
  try {
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await fetch(`${s.url}/api/health`)).status, 200);
  } finally {
    await s.close();
  }
  await assert.rejects(fetch(`${s.url}/api/health`));
});

test("falls back to a free port when the preferred default port is busy", async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, "127.0.0.1", r));
  const busy = blocker.address().port;
  const tm = await make();
  const s = await startServer({ config: tm.config, runner: tm.runner, port: busy, fallbackToRandom: true });
  try {
    assert.notEqual(new URL(s.url).port, String(busy));
  } finally {
    await s.close();
    blocker.close();
  }
});

test("an explicitly requested busy port fails loudly", async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, "127.0.0.1", r));
  const tm = await make();
  await assert.rejects(startServer({ config: tm.config, runner: tm.runner, port: blocker.address().port }), { code: "EADDRINUSE" });
  blocker.close();
});

test("launchUi starts the server and opens the browser with the fixed command", async () => {
  const calls = [];
  const spawnFn = (cmd, args, opts) => (calls.push({ cmd, args, opts }), { on() { return this; }, unref() {} });
  const { lines, log } = quietLog();
  const ui = await launchUi({ tm: await make(), port: 0, log, spawnFn, platform: "darwin" });
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

test("launchUi with open=false never spawns and warns per tool whose engine is missing", async () => {
  let spawned = false;
  const { lines, log } = quietLog();
  const needs = fakeTool({ manifest: { id: "needs-engine", engines: [fakeEngineSpec({ id: "nowhere", binary: "definitely-not-installed-xyz" })] } });
  const ui = await launchUi({ tm: await make({}, [needs]), port: 0, open: false, log, spawnFn: () => ((spawned = true), {}) });
  try {
    assert.equal(spawned, false);
    assert.ok(lines.some((l) => l.startsWith("WARN") && l.includes("needs-engine") && l.includes("toolmaster install needs-engine")));
  } finally {
    await ui.close();
  }
});

test("launchUi warns loudly when remote access is enabled", async () => {
  const { lines, log } = quietLog();
  const ui = await launchUi({ tm: await make({ TOOLMASTER_HOST: "127.0.0.1", TOOLMASTER_ALLOW_REMOTE: "1" }), port: 0, open: false, log });
  try {
    assert.ok(lines.some((l) => /remote access/i.test(l)));
  } finally {
    await ui.close();
  }
});

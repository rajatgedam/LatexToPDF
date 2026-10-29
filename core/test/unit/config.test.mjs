import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../config.mjs";

test("defaults are secure and loopback-bound", () => {
  const c = loadConfig({}, { projectRoot: "/tmp/p" });
  assert.equal(c.host, "127.0.0.1");
  assert.equal(c.port, 5757);
  assert.equal(c.maxInputBytes, 1_048_576);
  assert.equal(c.maxOutputBytes, 26_214_400);
  assert.equal(c.timeoutMs, 60_000);
  assert.equal(c.maxConcurrency, 2);
  assert.equal(c.rateLimitPerMin, 60);
  assert.equal(c.offline, false);
  assert.equal(c.sandbox, "auto");
  assert.equal(c.enabledTools, null);
  assert.equal(c.vendorDir, "/tmp/p/vendor");
  assert.equal(c.cacheRoot, "/tmp/p/vendor/cache");
});

test("env overrides are parsed", () => {
  const c = loadConfig(
    { TOOLMASTER_PORT: "8080", TOOLMASTER_TIMEOUT_MS: "5000", TOOLMASTER_OFFLINE: "1", TOOLMASTER_CACHE_DIR: "/x", TOOLMASTER_TOOLS: " Latex-To-PDF , latex-to-docx " },
    { projectRoot: "/tmp/p" },
  );
  assert.equal(c.port, 8080);
  assert.equal(c.portExplicit, true);
  assert.equal(c.timeoutMs, 5000);
  assert.equal(c.offline, true);
  assert.equal(c.cacheRoot, "/x");
  assert.deepEqual(c.enabledTools, ["latex-to-pdf", "latex-to-docx"]);
});

test("invalid numbers are rejected", () => {
  for (const bad of ["abc", "-1", "0", "1.5", "99999999999999"]) {
    assert.throws(() => loadConfig({ TOOLMASTER_TIMEOUT_MS: bad }), { code: "CONFIG_INVALID" }, bad);
  }
  assert.throws(() => loadConfig({ TOOLMASTER_PORT: "70000" }), { code: "CONFIG_INVALID" });
});

test("non-loopback host requires explicit opt-in", () => {
  assert.throws(() => loadConfig({ TOOLMASTER_HOST: "0.0.0.0" }), { code: "CONFIG_INVALID" });
  const c = loadConfig({ TOOLMASTER_HOST: "0.0.0.0", TOOLMASTER_ALLOW_REMOTE: "1" });
  assert.equal(c.host, "0.0.0.0");
  assert.equal(c.allowRemote, true);
});

test("allowed hosts are parsed, trimmed and lowercased", () => {
  assert.deepEqual(loadConfig({ TOOLMASTER_ALLOWED_HOSTS: " My-Box.local ,, other.lan " }).allowedHosts, ["my-box.local", "other.lan"]);
  assert.deepEqual(loadConfig({}).allowedHosts, []);
});

test("sandbox mode is validated", () => {
  assert.equal(loadConfig({ TOOLMASTER_SANDBOX: "off" }).sandbox, "off");
  assert.throws(() => loadConfig({ TOOLMASTER_SANDBOX: "maybe" }), { code: "CONFIG_INVALID" });
});

test("engine path overrides are collected per engine id", () => {
  const c = loadConfig({ TOOLMASTER_ENGINE_PANDOC: "/opt/pandoc", TOOLMASTER_ENGINE_MY_TOOL: "/x/y" });
  assert.deepEqual({ ...c.engineOverrides }, { pandoc: "/opt/pandoc", "my-tool": "/x/y" });
});

test("engines can live in a shared folder while packs stay next to the program", () => {
  const c = loadConfig({ TOOLMASTER_VENDOR_DIR: "/shared/engines" }, { projectRoot: "/tmp/p" });
  assert.equal(c.vendorDir, "/shared/engines");
  assert.equal(c.cacheRoot, "/shared/engines/cache");
  assert.equal(c.packDir, "/tmp/p/vendor");
  assert.equal(loadConfig({}, { projectRoot: "/tmp/p" }).packDir, "/tmp/p/vendor");
});

test("workers start from the source tree by default and from the caller's description when given", () => {
  const dflt = loadConfig({});
  assert.equal(dflt.self.command, process.execPath);
  assert.match(dflt.self.args[0], /core[\\/]worker-entry\.mjs$/);
  assert.equal(dflt.self.ro.length, 1);
  const custom = loadConfig({}, { self: { command: "/x/toolmaster", args: ["__worker"], ro: [] } });
  assert.deepEqual({ ...custom.self }, { command: "/x/toolmaster", args: ["__worker"], ro: [] });
});

test("config object is frozen", () => {
  const c = loadConfig({});
  assert.throws(() => {
    "use strict";
    c.port = 1;
  });
});

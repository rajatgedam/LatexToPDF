import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config.mjs";

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
  assert.equal(c.cacheDir, "/tmp/p/vendor/tectonic-cache");
});

test("env overrides are parsed", () => {
  const c = loadConfig(
    { LATEX2PDF_PORT: "8080", LATEX2PDF_TIMEOUT_MS: "5000", LATEX2PDF_OFFLINE: "1", TECTONIC_CACHE_DIR: "/x" },
    { projectRoot: "/tmp/p" },
  );
  assert.equal(c.port, 8080);
  assert.equal(c.timeoutMs, 5000);
  assert.equal(c.offline, true);
  assert.equal(c.cacheDir, "/x");
});

test("invalid numbers are rejected", () => {
  for (const bad of ["abc", "-1", "0", "1.5", "99999999999999"]) {
    assert.throws(() => loadConfig({ LATEX2PDF_TIMEOUT_MS: bad }), { code: "CONFIG_INVALID" }, bad);
  }
  assert.throws(() => loadConfig({ LATEX2PDF_PORT: "70000" }), { code: "CONFIG_INVALID" });
});

test("non-loopback host requires explicit opt-in", () => {
  assert.throws(() => loadConfig({ LATEX2PDF_HOST: "0.0.0.0" }), { code: "CONFIG_INVALID" });
  const c = loadConfig({ LATEX2PDF_HOST: "0.0.0.0", LATEX2PDF_ALLOW_REMOTE: "1" });
  assert.equal(c.host, "0.0.0.0");
  assert.equal(c.allowRemote, true);
});

test("allowed hosts are parsed, trimmed and lowercased", () => {
  assert.deepEqual(loadConfig({ LATEX2PDF_ALLOWED_HOSTS: " My-Box.local ,, other.lan " }).allowedHosts, ["my-box.local", "other.lan"]);
  assert.deepEqual(loadConfig({}).allowedHosts, []);
});

test("config object is frozen", () => {
  const c = loadConfig({});
  assert.throws(() => {
    "use strict";
    c.port = 1;
  });
});

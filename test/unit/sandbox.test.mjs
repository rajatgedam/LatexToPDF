import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxProfile, buildSandboxArgv } from "../../src/sandbox.mjs";
import { loadConfig } from "../../src/config.mjs";

test("profile denies reads of user data and writes outside work/cache", () => {
  const p = sandboxProfile({ offline: false });
  assert.match(p, /\(deny file-write\*\)/);
  assert.match(p, /\(deny file-read\*[^)]*\(subpath "\/Users"\)/s);
  assert.match(p, /\(allow file-write\* \(subpath \(param "WORK"\)\) \(subpath \(param "CACHE"\)\)/);
  assert.doesNotMatch(p, /deny network/);
});

test("offline profile also denies the network", () => {
  assert.match(sandboxProfile({ offline: true }), /\(deny network\*\)/);
});

test("argv passes paths as -D params, never interpolated into the profile", () => {
  const evil = '/tmp/x") (allow file-read* (subpath "/';
  const { cmd, args } = buildSandboxArgv({ engine: "/e/tectonic", engineArgs: ["-X", "compile"], work: evil, cache: "/c", engineDir: "/e", offline: false });
  assert.equal(cmd, "/usr/bin/sandbox-exec");
  const profile = args[args.indexOf("-p") + 1];
  assert.ok(!profile.includes(evil));
  assert.ok(args.includes(`WORK=${evil}`));
  assert.deepEqual(args.slice(-3), ["/e/tectonic", "-X", "compile"]);
});

test("config validates the sandbox mode", () => {
  assert.equal(loadConfig({}).sandbox, "auto");
  assert.equal(loadConfig({ LATEX2PDF_SANDBOX: "off" }).sandbox, "off");
  assert.throws(() => loadConfig({ LATEX2PDF_SANDBOX: "maybe" }), { code: "CONFIG_INVALID" });
});

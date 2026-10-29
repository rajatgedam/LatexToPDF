import { test } from "node:test";
import assert from "node:assert/strict";
import { sandboxProfile, buildSandboxArgv, wrapWithSandbox } from "../../sandbox.mjs";
import { loadConfig } from "../../config.mjs";

test("profile denies reads of user data and writes outside the allowed dirs", () => {
  const p = sandboxProfile({});
  assert.match(p, /\(deny file-write\*\)/);
  assert.match(p, /\(deny file-read\*[^)]*\(subpath "\/Users"\)/s);
  assert.match(p, /\(allow file-write\* \(subpath \(param "WORK"\)\) \(literal "\/dev\/null"\)/);
  assert.doesNotMatch(p, /deny network/);
});

test("extra read-write dirs become numbered params and network can be denied", () => {
  const p = sandboxProfile({ network: false, rwCount: 2 });
  assert.match(p, /\(subpath \(param "RW0"\)\) \(subpath \(param "RW1"\)\)/);
  assert.match(p, /\(deny network\*\)/);
});

test("argv passes paths as -D params, never interpolated into the profile", () => {
  const evil = '/tmp/x") (allow file-read* (subpath "/';
  const { cmd, args } = buildSandboxArgv({ command: "/e/tool", args: ["-X", "go"], work: evil, rw: ["/c"], engineDir: "/e", network: true });
  assert.equal(cmd, "/usr/bin/sandbox-exec");
  const profile = args[args.indexOf("-p") + 1];
  assert.ok(!profile.includes(evil));
  assert.ok(args.includes(`WORK=${evil}`));
  assert.ok(args.includes("RW0=/c"));
  assert.deepEqual(args.slice(-3), ["/e/tool", "-X", "go"]);
});

test("wrapWithSandbox is a no-op when off, on non-macOS, and fatal when required but missing", async () => {
  const off = await wrapWithSandbox({ command: "/bin/echo", args: ["x"], workdir: "/tmp", config: loadConfig({ TOOLMASTER_SANDBOX: "off" }), platform: "darwin" });
  assert.deepEqual(off, { cmd: "/bin/echo", args: ["x"], sandboxed: false });
  const linux = await wrapWithSandbox({ command: "/bin/echo", args: ["x"], workdir: "/tmp", config: loadConfig({}), platform: "linux" });
  assert.equal(linux.sandboxed, false);
  await assert.rejects(wrapWithSandbox({ command: "/bin/echo", args: [], workdir: "/tmp", config: loadConfig({ TOOLMASTER_SANDBOX: "on" }), platform: "linux" }), { code: "CONFIG_INVALID" });
});

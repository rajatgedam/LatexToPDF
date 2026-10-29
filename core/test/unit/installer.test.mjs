import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assetFor, assertSha256, installEngine } from "../../installer.mjs";
import { loadConfig } from "../../config.mjs";
import { fakeEngineSpec } from "../../../test/helpers/fake-tool.mjs";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const posix = process.platform !== "win32";
let work;
let archive;
let spec;

before(async () => {
  work = await mkdtemp(path.join(os.tmpdir(), "tm-inst-"));
  const pkg = path.join(work, "pkg-1.0", "bin");
  await mkdir(pkg, { recursive: true });
  await writeFile(path.join(pkg, "fakebin"), '#!/bin/sh\necho "fakebin 1.2.3"\n');
  await writeFile(path.join(work, "pkg-1.0", "README"), "docs");
  await chmod(path.join(pkg, "fakebin"), 0o755);
  const tgz = path.join(work, "fake-1.0-linux-x64.tar.gz");
  spawnSync("tar", ["-czf", tgz, "-C", work, "pkg-1.0"]);
  archive = await readFile(tgz);
  spec = fakeEngineSpec({
    id: "fake-engine",
    binary: "fakebin",
    assets: { "linux-x64": { url: "https://example.test/dl/fake-1.0-linux-x64.tar.gz", sha256: sha(archive) } },
  });
});
after(() => rm(work, { recursive: true, force: true }));

const fetchOk = (buf) => async () => new Response(buf, { status: 200 });

test("assetFor maps platform keys and decodes the file name", () => {
  const s = fakeEngineSpec({ assets: { "darwin-arm64": { url: "https://x.test/tectonic%400.17.0/tool-1.tar.gz", sha256: "b".repeat(64) } } });
  assert.deepEqual(assetFor(s, "darwin", "arm64"), { name: "tool-1.tar.gz", url: "https://x.test/tectonic%400.17.0/tool-1.tar.gz", sha256: "b".repeat(64) });
});

test("assetFor explains how to proceed on unsupported platforms", () => {
  assert.throws(() => assetFor(fakeEngineSpec({ id: "my-engine" }), "plan9", "mips"), /TOOLMASTER_ENGINE_MY_ENGINE/);
});

test("assertSha256 accepts a matching digest and rejects a mismatch", () => {
  const buf = Buffer.from("hello");
  assert.doesNotThrow(() => assertSha256(buf, sha(buf)));
  assert.throws(() => assertSha256(buf, "0".repeat(64)), /checksum/i);
});

test("installEngine verifies, extracts only the binary, and checks that it runs", { skip: !posix }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tm-inst-root-"));
  try {
    const logs = [];
    const cfg = loadConfig({}, { projectRoot: root });
    const r = await installEngine({ config: cfg, spec, platform: "linux", arch: "x64", fetchFn: fetchOk(archive), log: (m) => logs.push(m) });
    assert.equal(r.skipped, false);
    assert.equal(r.version, "fakebin 1.2.3");
    assert.deepEqual(await readdir(path.join(root, "vendor", "fake-engine")), ["fakebin"]);
    assert.ok(logs.some((l) => /SHA-256 verified/.test(l)));
    const again = await installEngine({ config: cfg, spec, platform: "linux", arch: "x64", fetchFn: async () => assert.fail("must not download again") });
    assert.equal(again.skipped, true);
    const forced = await installEngine({ config: cfg, spec, platform: "linux", arch: "x64", fetchFn: fetchOk(archive), force: true });
    assert.equal(forced.skipped, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a checksum mismatch aborts before anything is written", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tm-inst-root-"));
  try {
    await assert.rejects(installEngine({ config: loadConfig({}, { projectRoot: root }), spec, platform: "linux", arch: "x64", fetchFn: fetchOk(Buffer.from("tampered")) }), /checksum/i);
    await assert.rejects(readdir(path.join(root, "vendor")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("HTTP errors and archives without the binary are reported", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tm-inst-root-"));
  try {
    const cfg = loadConfig({}, { projectRoot: root });
    await assert.rejects(installEngine({ config: cfg, spec, platform: "linux", arch: "x64", fetchFn: async () => new Response("nope", { status: 404 }) }), /HTTP 404/);
    const empty = path.join(work, "empty.tar.gz");
    await mkdir(path.join(work, "emptydir"), { recursive: true });
    await writeFile(path.join(work, "emptydir", "other"), "x");
    spawnSync("tar", ["-czf", empty, "-C", work, "emptydir"]);
    const buf = await readFile(empty);
    const s2 = { ...spec, assets: { "linux-x64": { url: spec.assets["linux-x64"].url, sha256: sha(buf) } } };
    await assert.rejects(installEngine({ config: cfg, spec: s2, platform: "linux", arch: "x64", fetchFn: fetchOk(buf) }), /not found inside the archive/);
    await assert.rejects(installEngine({ config: cfg, spec: s2, platform: "linux", arch: "x64", fetchFn: fetchOk(Buffer.from("not an archive")) }), /checksum/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

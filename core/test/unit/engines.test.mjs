import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, copyFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../config.mjs";
import { resolveEngine, engineInfo, exeName } from "../../engines.mjs";
import { makeFakeEngine } from "../../../test/helpers/fake-engine.mjs";
import { fakeEngineSpec } from "../../../test/helpers/fake-tool.mjs";

let fake;
let root;
const spec = fakeEngineSpec({ id: "fake-engine", binary: "tectonic" });

before(async () => {
  fake = await makeFakeEngine();
  root = await mkdtemp(path.join(os.tmpdir(), "tm-eng-"));
});
after(async () => {
  await fake.cleanup();
  await rm(root, { recursive: true, force: true });
});

test("an explicit override wins and must be executable", async () => {
  const cfg = loadConfig({ TOOLMASTER_ENGINE_FAKE_ENGINE: fake.path }, { projectRoot: root });
  assert.equal(await resolveEngine(cfg, spec), fake.path);
  const bad = loadConfig({ TOOLMASTER_ENGINE_FAKE_ENGINE: "/nonexistent/x" }, { projectRoot: root });
  await assert.rejects(resolveEngine(bad, spec), { code: "ENGINE_NOT_FOUND" });
});

test("vendor/<id>/ is searched before PATH", async () => {
  const dir = path.join(root, "vendor", "fake-engine");
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, exeName("tectonic"));
  await copyFile(fake.path, target);
  await chmod(target, 0o755);
  assert.equal(await resolveEngine(loadConfig({}, { projectRoot: root }), spec), target);
});

test("a missing engine produces an actionable error", async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), "tm-eng-empty-"));
  const missing = fakeEngineSpec({ id: "nowhere", binary: "definitely-not-installed-xyz" });
  await assert.rejects(resolveEngine(loadConfig({}, { projectRoot: empty }), missing), /toolmaster install/);
  await rm(empty, { recursive: true, force: true });
});

test("engineInfo reports the first line of the version output", async () => {
  const cfg = loadConfig({ TOOLMASTER_ENGINE_FAKE_ENGINE: fake.path }, { projectRoot: root });
  assert.deepEqual(await engineInfo(cfg, spec), { id: "fake-engine", found: true, version: "Tectonic 0.17.0-fake", path: fake.path });
  const none = loadConfig({}, { projectRoot: root });
  assert.deepEqual(await engineInfo(none, fakeEngineSpec({ id: "nowhere", binary: "definitely-not-installed-xyz" })), { id: "nowhere", found: false });
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createPack, extractPack, ensureUnpacked } from "../../pack.mjs";

let dir;
const read = (...p) => readFile(path.join(dir, ...p), "utf8");

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tm-pack-"));
});
after(() => rm(dir, { recursive: true, force: true }));

async function sampleTree(name) {
  const src = path.join(dir, name);
  await mkdir(path.join(src, "sub", "deep"), { recursive: true });
  await writeFile(path.join(src, "tool"), "#!/bin/sh\necho hi\n", { mode: 0o755 });
  await writeFile(path.join(src, "sub", "data.txt"), "hello ".repeat(1000));
  await writeFile(path.join(src, "sub", "deep", "x.bin"), Buffer.from([0, 1, 2, 255]));
  return src;
}

const fakePack = (files, payloadFiles) => {
  const header = Buffer.from(JSON.stringify({ files }));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length);
  return Buffer.concat([Buffer.from("TMPK\u0001", "latin1"), zlib.brotliCompressSync(Buffer.concat([len, header, ...payloadFiles]))]);
};

test("a folder round-trips through a pack with contents and executable bits intact", async () => {
  const src = await sampleTree("rt-src");
  const pack = await createPack(src, { quality: 5 });
  assert.ok(pack.length < 2000, "repetitive data is compressed");
  const dest = path.join(dir, "rt-out");
  assert.deepEqual(await extractPack(pack, dest), { files: 3 });
  assert.equal(await read("rt-out", "sub", "data.txt"), "hello ".repeat(1000));
  assert.deepEqual([...(await readFile(path.join(dest, "sub", "deep", "x.bin")))], [0, 1, 2, 255]);
  if (process.platform !== "win32") {
    assert.ok(((await stat(path.join(dest, "tool"))).mode & 0o111) !== 0, "binary stays executable");
    assert.equal((await stat(path.join(dest, "sub", "data.txt"))).mode & 0o111, 0);
  }
});

test("extracting replaces an earlier unpack and leaves no temp folders behind", async () => {
  const dest = path.join(dir, "replace-out");
  await mkdir(dest);
  await writeFile(path.join(dest, "stale.txt"), "old");
  await extractPack(await createPack(await sampleTree("replace-src"), { quality: 3 }), dest);
  await assert.rejects(stat(path.join(dest, "stale.txt")));
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual((await readdir(dir)).filter((n) => n.startsWith(".replace-out-")), []);
});

test("anything that is not a pack, or is damaged, is refused", async () => {
  await assert.rejects(extractPack(Buffer.from("nope"), path.join(dir, "bad1")), { code: "TOOL_INVALID", message: /Not a ToolMaster pack/ });
  const pack = await createPack(await sampleTree("dmg-src"), { quality: 3 });
  const cut = pack.subarray(0, Math.floor(pack.length / 2));
  await assert.rejects(extractPack(cut, path.join(dir, "bad2")), { code: "TOOL_INVALID" });
  const sum = fakePack([{ p: "a.txt", m: 0o644, s: 3, h: "0".repeat(64) }], [Buffer.from("abc")]);
  await assert.rejects(extractPack(sum, path.join(dir, "bad3")), { code: "TOOL_INVALID", message: /checksum/ });
});

test("paths that could escape the target folder are refused", async () => {
  const { createHash } = await import("node:crypto");
  const h = createHash("sha256").update("abc").digest("hex");
  for (const p of ["../evil.txt", "/abs.txt", "a/../../b.txt", "a\\b.txt", "C:/x.txt", "a//b.txt", ""]) {
    const pack = fakePack([{ p, m: 0o644, s: 3, h }], [Buffer.from("abc")]);
    await assert.rejects(extractPack(pack, path.join(dir, "bad4")), { code: "TOOL_INVALID", message: /unsafe path/ }, p);
  }
  await assert.rejects(stat(path.join(dir, "evil.txt")));
});

test("ensureUnpacked unpacks once, re-unpacks when the pack changes, and reports a missing pack", async () => {
  const packFile = path.join(dir, "e.pack");
  const target = path.join(dir, "e-target");
  assert.equal(await ensureUnpacked(packFile, target), false);

  const src = await sampleTree("e-src");
  await writeFile(packFile, await createPack(src, { quality: 3 }));
  assert.equal(await ensureUnpacked(packFile, target), true);
  await writeFile(path.join(target, "marker.txt"), "still here");
  assert.equal(await ensureUnpacked(packFile, target), true);
  assert.equal(await read("e-target", "marker.txt"), "still here", "second call does not unpack again");

  await writeFile(path.join(src, "sub", "data.txt"), "changed");
  await writeFile(packFile, await createPack(src, { quality: 3 }));
  await utimes(packFile, new Date(), new Date(Date.now() + 5000));
  await ensureUnpacked(packFile, target);
  assert.equal(await read("e-target", "sub", "data.txt"), "changed");
  await assert.rejects(stat(path.join(target, "marker.txt")));
});

test("concurrent callers share one unpack", async () => {
  const packFile = path.join(dir, "c.pack");
  await writeFile(packFile, await createPack(await sampleTree("c-src"), { quality: 3 }));
  const results = await Promise.all(Array.from({ length: 5 }, () => ensureUnpacked(packFile, path.join(dir, "c-target"))));
  assert.deepEqual(results, [true, true, true, true, true]);
  assert.equal(await read("c-target", "sub", "deep", "x.bin").then((s) => s.length > 0), true);
});

test("packing refuses symlinks so a pack can never reference files outside its folder", async () => {
  if (process.platform === "win32") return;
  const { symlink } = await import("node:fs/promises");
  const src = await sampleTree("link-src");
  await symlink("/etc/hosts", path.join(src, "link"));
  await assert.rejects(createPack(src, { quality: 3 }), { code: "TOOL_INVALID", message: /only regular files/ });
});

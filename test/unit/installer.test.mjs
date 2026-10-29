import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assetFor, assertSha256, PINNED_VERSION } from "../../src/installer.mjs";

test("maps supported platforms to pinned assets with checksums", () => {
  const a = assetFor("darwin", "arm64");
  assert.match(a.name, /^tectonic-0\.17\.0-aarch64-apple-darwin\.tar\.gz$/);
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.equal(a.url, `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${PINNED_VERSION}/${a.name}`);
  assert.match(assetFor("darwin", "x64").name, /x86_64-apple-darwin/);
  assert.match(assetFor("linux", "x64").name, /x86_64-unknown-linux-musl/);
  assert.match(assetFor("win32", "x64").name, /x86_64-pc-windows-msvc\.zip/);
});

test("unsupported platforms throw", () => {
  assert.throws(() => assetFor("plan9", "mips"), /unsupported/i);
});

test("assertSha256 accepts a matching digest and rejects a mismatch", () => {
  const buf = Buffer.from("hello");
  const ok = createHash("sha256").update(buf).digest("hex");
  assert.doesNotThrow(() => assertSha256(buf, ok));
  assert.throws(() => assertSha256(buf, "0".repeat(64)), /checksum/i);
});

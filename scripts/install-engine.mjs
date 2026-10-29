#!/usr/bin/env node
// Downloads the pinned Tectonic release into vendor/tectonic/, verifying its SHA-256 before extraction.
import { mkdir, writeFile, rm, chmod, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetFor, assertSha256, PINNED_VERSION } from "../src/installer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "vendor", "tectonic");
const exe = path.join(dir, process.platform === "win32" ? "tectonic.exe" : "tectonic");
const force = process.argv.includes("--force");

const exists = (p) => access(p).then(() => true, () => false);

if (!force && (await exists(exe))) {
  console.log(`Engine already installed at ${exe} (use --force to reinstall)`);
  process.exit(0);
}

const asset = assetFor(process.platform, process.arch);
console.log(`Downloading ${asset.name} ...`);
const res = await fetch(asset.url, { redirect: "follow", signal: AbortSignal.timeout(300_000) });
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
const archive = Buffer.from(await res.arrayBuffer());

assertSha256(archive, asset.sha256);
console.log("SHA-256 verified.");

await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
const archivePath = path.join(dir, asset.name);
await writeFile(archivePath, archive);
const tar = spawnSync("tar", ["-xf", archivePath, "-C", dir], { stdio: "inherit" });
await rm(archivePath, { force: true });
if (tar.status !== 0) throw new Error("Extraction failed");
await chmod(exe, 0o755);

const v = spawnSync(exe, ["--version"], { encoding: "utf8" });
if (v.status !== 0) throw new Error(`Installed engine failed to run: ${v.stderr}`);
console.log(`Installed ${v.stdout.trim()} (pinned ${PINNED_VERSION}) at ${exe}`);

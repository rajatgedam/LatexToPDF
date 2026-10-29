import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rename, copyFile, rm, writeFile, chmod, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolMasterError } from "./errors.mjs";
import { exeName } from "./engines.mjs";

export function assetFor(spec, platform = process.platform, arch = process.arch) {
  const asset = spec.assets[`${platform}-${arch}`];
  if (!asset) {
    throw new ToolMasterError("ENGINE_NOT_FOUND", `No ${spec.id} build for ${platform}/${arch}; install it yourself and set TOOLMASTER_ENGINE_${spec.id.toUpperCase().replace(/-/g, "_")}`);
  }
  return { name: decodeURIComponent(new URL(asset.url).pathname.split("/").pop()), url: asset.url, sha256: asset.sha256 };
}

export function assertSha256(buffer, expectedHex) {
  const actual = createHash("sha256").update(buffer).digest("hex");
  if (actual !== expectedHex) throw new Error(`Checksum mismatch: expected ${expectedHex}, got ${actual}`);
}

async function findFile(dir, name) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const hit = await findFile(full, name);
      if (hit) return hit;
    }
  }
  return null;
}

/** Download a pinned engine, verify its SHA-256 before touching disk, extract only its binary into vendor/<id>/. */
export async function installEngine({ config, spec, platform = process.platform, arch = process.arch, fetchFn = fetch, log = () => {}, force = false }) {
  const target = path.join(config.vendorDir, spec.id);
  const exe = path.join(target, exeName(spec.binary));
  if (!force && (await access(exe).then(() => true, () => false))) return { path: exe, skipped: true };

  const asset = assetFor(spec, platform, arch);
  log(`Downloading ${asset.name} ...`);
  const res = await fetchFn(asset.url, { redirect: "follow", signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const archive = Buffer.from(await res.arrayBuffer());
  assertSha256(archive, asset.sha256);
  log("SHA-256 verified.");

  const scratch = await mkdtemp(path.join(os.tmpdir(), "tm-install-"));
  try {
    const archivePath = path.join(scratch, asset.name);
    await writeFile(archivePath, archive);
    const out = path.join(scratch, "x");
    await mkdir(out);
    const tar = spawnSync("tar", ["-xf", archivePath, "-C", out], { stdio: "ignore" });
    if (tar.status !== 0) throw new Error("Extraction failed");
    const found = await findFile(out, exeName(spec.binary));
    if (!found) throw new Error(`${exeName(spec.binary)} not found inside the archive`);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    await rename(found, exe).catch(() => copyFile(found, exe));
    await chmod(exe, 0o755);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  const version = execFileSync(exe, spec.versionArgs, { encoding: "utf8", timeout: 20_000 }).split("\n")[0].trim();
  log(`Installed ${version} at ${exe}`);
  return { path: exe, version, skipped: false };
}

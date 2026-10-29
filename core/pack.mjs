import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdir, mkdtemp, rename, rm, stat, chmod } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { ToolMasterError } from "./errors.mjs";

const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);

const MAGIC = Buffer.from("TMPK\u0001", "latin1");
const MAX_UNPACKED = 2 * 1024 ** 3;
const STAMP = ".pack-stamp";
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
    else throw new ToolMasterError("TOOL_INVALID", `Refusing to pack "${entry.name}": only regular files and folders are allowed`);
  }
  return out;
}

/**
 * Pack a folder into one Brotli-compressed file (build time only). Engines and caches are stored this way inside
 * downloads and unpacked on first use, so users download compressed bytes but still run the original binaries.
 */
export async function createPack(dir, { quality = 11 } = {}) {
  const files = [];
  const chunks = [];
  for (const rel of await listFiles(dir)) {
    const full = path.join(dir, rel);
    const [data, info] = await Promise.all([readFile(full), stat(full)]);
    files.push({ p: rel, m: info.mode & 0o111 ? 0o755 : 0o644, s: data.length, h: sha256(data) });
    chunks.push(data);
  }
  const header = Buffer.from(JSON.stringify({ files }), "utf8");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(header.length);
  const payload = Buffer.concat([prefix, header, ...chunks]);
  const packed = await brotliCompress(payload, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
      [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: payload.length,
    },
  });
  return Buffer.concat([MAGIC, packed]);
}

const safeRelative = (p) => {
  const bad = typeof p !== "string" || p === "" || p.includes("\0") || p.includes("\\") || p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.split("/").some((s) => s === ".." || s === "." || s === "");
  if (bad) throw new ToolMasterError("TOOL_INVALID", "Corrupt pack: unsafe path");
  return p;
};

/** Unpack into `dest`, replacing it. Verifies every file's size and SHA-256 and rejects unsafe paths. Atomic via a temp folder + rename. */
export async function extractPack(buffer, dest) {
  if (buffer.length < MAGIC.length || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new ToolMasterError("TOOL_INVALID", "Not a ToolMaster pack");
  let payload;
  try {
    payload = await brotliDecompress(buffer.subarray(MAGIC.length), { maxOutputLength: MAX_UNPACKED });
  } catch {
    throw new ToolMasterError("TOOL_INVALID", "Corrupt pack: cannot decompress");
  }
  const headerLen = payload.readUInt32BE(0);
  const { files } = JSON.parse(payload.subarray(4, 4 + headerLen).toString("utf8"));
  const parent = path.dirname(dest);
  await mkdir(parent, { recursive: true });
  const tmp = await mkdtemp(path.join(parent, `.${path.basename(dest)}-`));
  try {
    let offset = 4 + headerLen;
    for (const f of files) {
      const rel = safeRelative(f.p);
      const data = payload.subarray(offset, offset + f.s);
      offset += f.s;
      if (data.length !== f.s || sha256(data) !== f.h) throw new ToolMasterError("TOOL_INVALID", `Corrupt pack: checksum mismatch for ${rel}`);
      const target = path.join(tmp, ...rel.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data, { mode: f.m === 0o755 ? 0o755 : 0o644 });
      await chmod(target, f.m === 0o755 ? 0o755 : 0o644);
    }
    await rm(dest, { recursive: true, force: true });
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { recursive: true, force: true });
    // another process finished first: keep its result
    if (err?.code === "ENOTEMPTY" || err?.code === "EEXIST") return { files: files.length };
    throw err;
  }
  return { files: files.length };
}

const inflight = new Map();

/**
 * Make `target` exist by unpacking `packFile` once. A stamp (size + mtime of the pack) lets a newer pack replace an older
 * unpack, and costs one stat per call afterwards. Returns false when there is no pack (nothing to do).
 */
export async function ensureUnpacked(packFile, target) {
  const info = await stat(packFile).catch(() => null);
  if (!info?.isFile()) return false;
  const stamp = `${info.size}-${Math.round(info.mtimeMs)}`;
  const current = await readFile(path.join(target, STAMP), "utf8").catch(() => null);
  if (current === stamp) return true;
  const key = `${packFile}>${target}`;
  if (!inflight.has(key)) {
    inflight.set(
      key,
      (async () => {
        await extractPack(await readFile(packFile), target);
        await writeFile(path.join(target, STAMP), stamp);
      })().finally(() => inflight.delete(key)),
    );
  }
  await inflight.get(key);
  return true;
}

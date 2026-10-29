import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const text = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(body);
  return true;
};

/** Safe static file server rooted at `root` (GET/HEAD only; SPA fallback for extensionless routes). */
export function createStaticHandler(root) {
  let rootReal;

  async function resolveInside(rel) {
    rootReal ??= await realpath(root);
    const target = path.resolve(rootReal, `.${rel}`);
    if (target !== rootReal && !target.startsWith(rootReal + path.sep)) return null;
    const real = await realpath(target).catch(() => null);
    if (!real || (real !== rootReal && !real.startsWith(rootReal + path.sep))) return null;
    const info = await stat(real).catch(() => null);
    return info?.isFile() ? { file: real, size: info.size } : null;
  }

  return async function serve(req, res, pathname) {
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return text(res, 400, "Bad request");
    }
    if (rel.includes("\0") || rel.includes("\\") || rel.split("/").includes("..")) return text(res, 400, "Bad request");
    if (rel.endsWith("/")) rel += "index.html";

    let found;
    try {
      found = await resolveInside(rel);
      if (!found && !path.extname(rel)) found = await resolveInside("/index.html");
    } catch (err) {
      if (err.code === "ENOENT" && !rootReal) return text(res, 503, "UI not built. Run: npm run build:web");
      throw err;
    }
    if (!found) return text(res, 404, "Not found");

    const ext = path.extname(found.file).toLowerCase();
    res.statusCode = 200;
    res.setHeader("content-type", MIME[ext] ?? "application/octet-stream");
    res.setHeader("content-length", String(found.size));
    res.setHeader("cache-control", rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    createReadStream(found.file).on("error", () => res.destroy()).pipe(res);
    return true;
  };
}

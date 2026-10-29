import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createStaticHandler } from "../../server/static.mjs";

let root;
let outside;
let server;
let port;

const get = (p, { method = "GET" } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end();
  });

before(async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "l2p-static-"));
  root = path.join(base, "dist");
  outside = path.join(base, "outside");
  await mkdir(path.join(root, "assets"), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(root, "index.html"), "<html>INDEX</html>");
  await writeFile(path.join(root, "assets", "app-abc123.js"), "console.log(1)");
  await writeFile(path.join(root, "style.css"), "a{}");
  await writeFile(path.join(outside, "secret.txt"), "SECRET");
  await symlink(path.join(outside, "secret.txt"), path.join(root, "leak.txt"));
  const serve = createStaticHandler(root);
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (!(await serve(req, res, url.pathname))) {
      res.statusCode = 599;
      res.end("unhandled");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(async () => {
  server.close();
  await rm(path.dirname(root), { recursive: true, force: true });
});

test("serves index at / with revalidation and correct type", async () => {
  const r = await get("/");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /text\/html/);
  assert.match(r.body, /INDEX/);
  assert.equal(r.headers["cache-control"], "no-cache");
});

test("serves hashed assets as immutable with the right mime type", async () => {
  const r = await get("/assets/app-abc123.js");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /javascript/);
  assert.match(r.headers["cache-control"], /immutable/);
  assert.match((await get("/style.css")).headers["content-type"], /text\/css/);
});

test("HEAD returns headers without a body", async () => {
  const r = await get("/style.css", { method: "HEAD" });
  assert.equal(r.status, 200);
  assert.equal(r.body, "");
  assert.equal(r.headers["content-length"], "3");
});

test("unknown extensionless paths fall back to the SPA shell; missing files 404", async () => {
  assert.match((await get("/some/route")).body, /INDEX/);
  assert.equal((await get("/missing.js")).status, 404);
});

test("path traversal attempts never leave the web root", async () => {
  for (const p of ["/../outside/secret.txt", "/%2e%2e/outside/secret.txt", "/assets/..%2f..%2foutside%2fsecret.txt", "/..%5coutside%5csecret.txt", "/%00", "/assets/%00.js", "/%2e%2e%2f%2e%2e%2fetc/passwd"]) {
    const r = await get(p);
    assert.ok([400, 404].includes(r.status) || r.body.includes("INDEX"), `${p} -> ${r.status}`);
    assert.ok(!r.body.includes("SECRET"), p);
  }
});

test("symlinks that escape the root are refused", async () => {
  const r = await get("/leak.txt");
  assert.equal(r.status, 404);
  assert.ok(!r.body.includes("SECRET"));
});

test("a missing web root yields a helpful 503 instead of a crash", async () => {
  const serve = createStaticHandler("/nonexistent/dist");
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  assert.equal(await serve({ method: "GET" }, res, "/"), true);
  assert.equal(res.statusCode, 503);
  assert.match(res.body, /build:web/);
});

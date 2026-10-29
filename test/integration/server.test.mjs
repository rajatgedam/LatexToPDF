import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../src/config.mjs";
import { engineInfo } from "../../src/engine.mjs";
import { startServer } from "../../src/server/index.mjs";
import { countPages } from "../../src/pdf.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = loadConfig({ LATEX2PDF_TIMEOUT_MS: "120000", LATEX2PDF_MAX_CONCURRENCY: "2", LATEX2PDF_RATE_LIMIT_PER_MIN: "1000" });
const hasEngine = (await engineInfo(config)).found;
const opts = { skip: hasEngine ? false : "tectonic not installed (npm run install:engine)" };

let srv;
before(async () => {
  srv = await startServer({ config, port: 0 });
});
after(() => srv?.close());

const post = (body, type = "application/json", extra = {}) =>
  fetch(`${srv.url}/api/compile`, { method: "POST", headers: { "content-type": type, ...extra }, body: type === "application/json" ? JSON.stringify(body) : body });

test("health shows the real engine", opts, async () => {
  const j = await (await fetch(`${srv.url}/api/health`)).json();
  assert.equal(j.engine.found, true);
  assert.match(j.engine.version, /Tectonic/);
});

test("POST the example resume returns a real one-page PDF", opts, async () => {
  const source = await readFile(path.join(root, "examples/resume.tex"), "utf8");
  const res = await post({ source });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(res.headers.get("x-latex2pdf-pages"), "1");
  const pdf = Buffer.from(await res.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(countPages(pdf), 1);
});

test("raw text body works end to end", opts, async () => {
  const res = await post("Hello from curl.", "text/plain");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-latex2pdf-pages"), "1");
});

test("LaTeX errors come back as 422 with the log", opts, async () => {
  const res = await post({ source: "\\documentclass{article}\\begin{document}\\nope\\end{document}" });
  assert.equal(res.status, 422);
  const j = await res.json();
  assert.equal(j.error.code, "COMPILE_FAILED");
  assert.match(j.error.log, /Undefined control sequence/);
  assert.ok(!j.error.log.includes(os.tmpdir() + "/l2p-work-"));
});

test("shell-escape payload is refused and nothing is executed", opts, async () => {
  const marker = path.join(os.tmpdir(), `l2p-pwn-${process.pid}`);
  const res = await post({ source: `\\documentclass{article}\\begin{document}\\immediate\\write18{touch ${marker}}\\end{document}` });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, "POLICY_VIOLATION");
  await assert.rejects(access(marker), { code: "ENOENT" });
});

test("a burst beyond the concurrency limit yields 503s, never 500s", opts, async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => post("burst", "text/plain")));
  const codes = results.map((r) => r.status);
  assert.ok(codes.includes(200));
  assert.ok(codes.every((c) => c === 200 || c === 503), codes.join(","));
});

test("foreign Host header is rejected over a real socket", opts, async () => {
  const { default: http } = await import("node:http");
  const status = await new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: new URL(srv.url).port, path: "/api/health", headers: { host: "evil.test" } }, (r) => { r.resume(); resolve(r.statusCode); });
    req.end();
  });
  assert.equal(status, 403);
});

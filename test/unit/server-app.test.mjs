import { test, after } from "node:test";
import assert from "node:assert/strict";
import { LatexToPdfError } from "../../src/errors.mjs";
import { startTestServer } from "../helpers/server.mjs";

const servers = [];
const start = async (opts) => {
  const s = await startTestServer(opts);
  servers.push(s);
  return s;
};
after(() => Promise.all(servers.map((s) => s.close())));

test("health reports engine status without leaking paths", async () => {
  const s = await start();
  const r = await s.request("/api/health");
  assert.equal(r.status, 200);
  const j = r.json();
  assert.equal(j.ok, true);
  assert.ok("engine" in j);
  assert.ok(!r.text.includes("/Users"));
});

test("compile via JSON returns the PDF with safe headers and metadata", async () => {
  let seen;
  const s = await start({ compile: async (o) => ((seen = o), { pdf: Buffer.from("%PDF-1.5 hi"), pages: 2, durationMs: 12, warnings: [], kind: "latex" }) });
  const r = await s.post({ source: "\\documentclass{article}", mode: "latex" });
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-type"], "application/pdf");
  assert.match(r.headers["content-disposition"], /^inline; filename="resume\.pdf"$/);
  assert.equal(r.headers["x-latex2pdf-pages"], "2");
  assert.equal(r.headers["x-latex2pdf-duration-ms"], "12");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.text, "%PDF-1.5 hi");
  assert.equal(seen.source, "\\documentclass{article}");
  assert.equal(seen.mode, "latex");
  assert.ok(seen.signal instanceof AbortSignal);
});

test("compile accepts raw text/plain and application/x-tex bodies", async () => {
  const sources = [];
  const s = await start({ compile: async (o) => (sources.push(o.source), { pdf: Buffer.from("%PDF-"), pages: 1, durationMs: 1, warnings: [], kind: "text" }) });
  assert.equal((await s.request("/api/compile", { method: "POST", headers: { "content-type": "text/plain; charset=utf-8" }, body: "héllo" })).status, 200);
  assert.equal((await s.request("/api/compile", { method: "POST", headers: { "content-type": "application/x-tex" }, body: "\\x" })).status, 200);
  assert.deepEqual(sources, ["héllo", "\\x"]);
});

test("invalid JSON / wrong shapes are 400, unsupported media type is 415", async () => {
  const s = await start();
  assert.equal((await s.post("{nope")).status, 400);
  assert.equal((await s.post({ source: 5 })).status, 400);
  assert.equal((await s.post({ source: "x", mode: 5 })).status, 400);
  assert.equal((await s.post("[]")).status, 400);
  const r = await s.request("/api/compile", { method: "POST", headers: { "content-type": "application/xml" }, body: "<a/>" });
  assert.equal(r.status, 415);
  assert.equal((await s.request("/api/compile", { method: "POST", body: "x" })).status, 415);
});

test("oversized bodies get 413", async () => {
  const s = await start({ env: { LATEX2PDF_MAX_INPUT_BYTES: "100" } });
  assert.equal((await s.request("/api/compile", { method: "POST", headers: { "content-type": "text/plain" }, body: "x".repeat(500) })).status, 413);
});

test("compiler errors map to stable statuses and JSON bodies", async () => {
  const cases = { INPUT_EMPTY: 400, INPUT_INVALID: 400, INPUT_TOO_LARGE: 413, POLICY_VIOLATION: 422, COMPILE_FAILED: 422, OUTPUT_TOO_LARGE: 422, TIMEOUT: 504, BUSY: 503, ENGINE_NOT_FOUND: 503 };
  for (const [code, status] of Object.entries(cases)) {
    const s = await start({ compile: async () => { throw new LatexToPdfError(code, `msg ${code}`, { log: "the log" }); } });
    const r = await s.post({ source: "x" });
    assert.equal(r.status, status, code);
    assert.equal(r.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(r.json().error.code, code);
    assert.equal(r.json().error.log, "the log");
  }
});

test("BUSY carries Retry-After", async () => {
  const s = await start({ compile: async () => { throw new LatexToPdfError("BUSY", "busy"); } });
  assert.ok((await s.post({ source: "x" })).headers["retry-after"]);
});

test("unexpected errors return a generic 500 without internals", async () => {
  const s = await start({ compile: async () => { throw new Error("boom at /Users/secret/path"); } });
  const orig = console.error;
  console.error = () => {};
  const r = await s.post({ source: "x" });
  console.error = orig;
  assert.equal(r.status, 500);
  assert.equal(r.json().error.code, "INTERNAL");
  assert.ok(!r.text.includes("boom") && !r.text.includes("/Users"));
});

test("rejects foreign Host headers (DNS rebinding) with 403 on every route", async () => {
  const s = await start();
  for (const p of ["/api/health", "/", "/api/compile"]) {
    const r = await s.request(p, { headers: { host: "evil.test" } });
    assert.equal(r.status, 403, p);
  }
});

test("rejects cross-origin POSTs and cross-site fetch metadata, allows same-origin", async () => {
  const s = await start();
  assert.equal((await s.post({ source: "x" }, { origin: "https://evil.test" })).status, 403);
  assert.equal((await s.post({ source: "x" }, { origin: "null" })).status, 403);
  assert.equal((await s.post({ source: "x" }, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await s.post({ source: "x" }, { origin: `http://127.0.0.1:${s.port}`, "sec-fetch-site": "same-origin" })).status, 200);
});

test("never emits CORS headers, even for preflight", async () => {
  const s = await start();
  const r = await s.request("/api/compile", { method: "OPTIONS", headers: { origin: "https://evil.test", "access-control-request-method": "POST" } });
  assert.equal(r.status, 403);
  assert.equal(r.headers["access-control-allow-origin"], undefined);
  const ok = await s.request("/api/compile", { method: "OPTIONS" });
  assert.equal(ok.status, 405);
  assert.equal(ok.headers["access-control-allow-origin"], undefined);
});

test("method and route restrictions", async () => {
  const s = await start();
  assert.equal((await s.request("/api/compile")).status, 405);
  assert.match((await s.request("/api/compile")).headers.allow, /POST/);
  assert.equal((await s.request("/api/health", { method: "POST", body: "x" })).status, 405);
  assert.equal((await s.request("/", { method: "DELETE" })).status, 405);
  assert.equal((await s.request("/api/nope")).status, 404);
});

test("rate limiting returns 429 with Retry-After", async () => {
  const s = await start({ env: { LATEX2PDF_RATE_LIMIT_PER_MIN: "3" } });
  for (let i = 0; i < 3; i++) assert.equal((await s.request("/api/health")).status, 200);
  const r = await s.request("/api/health");
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers["retry-after"]) >= 1);
});

test("client disconnect aborts the in-flight compile", async () => {
  let aborted;
  const started = Promise.withResolvers();
  const s = await start({
    compile: ({ signal }) => new Promise((_, reject) => {
      started.resolve();
      signal.addEventListener("abort", () => { aborted = true; reject(new LatexToPdfError("TIMEOUT", "cancelled")); });
    }),
  });
  const http = await import("node:http");
  const req = http.request({ host: "127.0.0.1", port: s.port, path: "/api/compile", method: "POST", headers: { "content-type": "application/json" } });
  req.on("error", () => {});
  req.end(JSON.stringify({ source: "x" }));
  await started.promise;
  req.destroy();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(aborted, true);
});

test("security headers are present on static and error responses too", async () => {
  const s = await start();
  for (const p of ["/", "/api/nope", "/api/health"]) {
    const r = await s.request(p);
    assert.ok(r.headers["content-security-policy"], p);
    assert.equal(r.headers["x-frame-options"], "DENY", p);
  }
});

test("remote bind is refused without opt-in", async () => {
  const { loadConfig } = await import("../../src/config.mjs");
  assert.throws(() => loadConfig({ LATEX2PDF_HOST: "0.0.0.0" }), { code: "CONFIG_INVALID" });
});

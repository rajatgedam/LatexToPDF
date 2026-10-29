import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { ToolMasterError } from "../../sdk.mjs";
import { fakeTool } from "../../../test/helpers/fake-tool.mjs";
import { startTestServer, serverTestTools } from "../../../test/helpers/server.mjs";

const servers = [];
const start = async (opts) => {
  const s = await startTestServer(opts);
  servers.push(s);
  return s;
};
after(() => Promise.all(servers.map((s) => s.close())));

const throwing = (code) => [fakeTool({ manifest: { id: "boom" }, run: async () => { throw new ToolMasterError(code, `msg ${code}`, { log: "the log" }); } })];

test("health reports per-tool readiness without leaking paths", async () => {
  const s = await start();
  const r = await s.request("/api/health");
  assert.equal(r.status, 200);
  const j = r.json();
  assert.equal(j.ok, true);
  assert.deepEqual(j.tools.echo, { ready: true, engines: [] });
  assert.ok(!r.text.includes("/Users") && !r.text.includes("/tmp/tm-server-test"));
});

test("the tool catalog is public metadata only (no engine download details)", async () => {
  const s = await start();
  const j = (await s.request("/api/tools")).json();
  assert.deepEqual(j.tools.map((t) => t.id).sort(), ["blob", "echo", "htmlish"]);
  const echo = j.tools.find((t) => t.id === "echo");
  assert.equal(echo.sample, "sample");
  assert.equal(echo.options[0].id, "mode");
  assert.equal(echo.status.ready, true);
  assert.equal("engines" in echo, false);
  assert.ok(!(await s.request("/api/tools")).text.includes("sha256"));
});

test("run via JSON returns the file with safe headers, escaped metadata and timing", async () => {
  const s = await start();
  const r = await s.post("echo", { input: "hi", options: { mode: "b" } });
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-type"], "application/pdf");
  assert.equal(r.headers["content-disposition"], 'inline; filename="output.pdf"');
  assert.ok(Number(r.headers["x-toolmaster-duration-ms"]) >= 0);
  assert.equal(r.headers["x-toolmaster-warnings"], "1");
  assert.deepEqual(JSON.parse(r.headers["x-toolmaster-meta"]), { pages: 2, note: "café" });
  assert.match(r.headers["x-toolmaster-meta"], /caf\\u00e9/);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.text, "%PDF-1.5 fake|hi|b");
});

test("run accepts raw text bodies with options in the query string", async () => {
  const s = await start();
  const a = await s.request("/api/tools/echo/run?mode=b", { method: "POST", headers: { "content-type": "text/plain; charset=utf-8" }, body: "héllo" });
  assert.equal(a.status, 200);
  assert.equal(a.text, "%PDF-1.5 fake|héllo|b");
  const b = await s.request("/api/tools/echo/run", { method: "POST", headers: { "content-type": "application/x-tex" }, body: "\\x" });
  assert.equal(b.text, "%PDF-1.5 fake|\\x|a");
});

test("binary tools take application/octet-stream and refuse JSON or text", async () => {
  const s = await start();
  const ok = await s.request("/api/tools/blob/run", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: Buffer.from([1, 2, 3]) });
  assert.equal(ok.status, 200);
  assert.deepEqual([...ok.buffer], [3, 2, 1]);
  assert.equal(ok.headers["content-disposition"], 'attachment; filename="output.bin"');
  assert.equal((await s.post("blob", { input: "x" })).status, 415);
  assert.equal((await s.request("/api/tools/blob/run", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" })).status, 415);
});

test("unsupported media types and malformed bodies", async () => {
  const s = await start();
  assert.equal((await s.post("echo", "{nope")).status, 400);
  assert.equal((await s.post("echo", { input: 5 })).status, 400);
  assert.equal((await s.post("echo", "[]")).status, 400);
  assert.equal((await s.post("echo", { input: "x", options: { mode: "zzz" } })).status, 400);
  assert.equal((await s.post("echo", { input: "x", options: { bogus: 1 } })).status, 400);
  assert.equal((await s.post("echo", { input: "" })).status, 400);
  assert.equal((await s.request("/api/tools/echo/run", { method: "POST", headers: { "content-type": "application/xml" }, body: "<a/>" })).status, 415);
  assert.equal((await s.request("/api/tools/echo/run", { method: "POST", body: "x" })).status, 415);
  const bad = await s.request("/api/tools/echo/run", { method: "POST", headers: { "content-type": "text/plain" }, body: Buffer.from([0xff, 0xfe]) });
  assert.equal(bad.status, 400);
});

test("unknown tools are 404 before the body is read", async () => {
  const s = await start();
  const r = await s.post("ghost", { input: "x" });
  assert.equal(r.status, 404);
  assert.equal(r.json().error.code, "TOOL_NOT_FOUND");
  assert.equal((await s.request("/api/tools/Bad_Id/run", { method: "POST" })).status, 404);
});

test("oversized bodies get 413", async () => {
  const s = await start({ env: { TOOLMASTER_MAX_INPUT_BYTES: "100" } });
  assert.equal((await s.request("/api/tools/echo/run", { method: "POST", headers: { "content-type": "text/plain" }, body: "x".repeat(500) })).status, 413);
});

test("preview returns html for tools that declare it, and 400 otherwise", async () => {
  const s = await start();
  const p = await s.post("htmlish", { input: "hi" }, {}, "preview");
  assert.equal(p.status, 200);
  assert.match(p.headers["content-type"], /^text\/html/);
  assert.equal(p.text, "<p>hi</p>");
  assert.equal(p.headers["x-toolmaster-meta"], undefined);
  assert.equal((await s.post("echo", { input: "hi" }, {}, "preview")).status, 400);
  assert.equal((await s.request("/api/tools/htmlish/preview")).status, 405);
});

test("tool errors map to stable statuses and JSON bodies", async () => {
  const cases = { INPUT_EMPTY: 400, INPUT_INVALID: 400, INPUT_TOO_LARGE: 413, POLICY_VIOLATION: 422, TOOL_FAILED: 422, OUTPUT_TOO_LARGE: 422, TIMEOUT: 504, BUSY: 503, ENGINE_NOT_FOUND: 503 };
  for (const [code, status] of Object.entries(cases)) {
    const s = await start({ tools: throwing(code) });
    const r = await s.post("boom", { input: "x" });
    assert.equal(r.status, status, code);
    assert.equal(r.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(r.json().error.code, code);
    assert.equal(r.json().error.log, "the log");
    if (code === "BUSY") assert.ok(r.headers["retry-after"]);
  }
});

test("unexpected errors return a generic 500 without internals", async () => {
  const s = await start({ tools: [fakeTool({ manifest: { id: "boom" }, run: async () => { throw new Error("boom at /Users/secret/path"); } })] });
  const orig = console.error;
  console.error = () => {};
  const r = await s.post("boom", { input: "x" });
  console.error = orig;
  assert.equal(r.status, 500);
  assert.equal(r.json().error.code, "INTERNAL");
  assert.ok(!r.text.includes("boom") && !r.text.includes("/Users"));
});

test("rejects foreign Host headers (DNS rebinding) with 403 on every route", async () => {
  const s = await start();
  for (const p of ["/api/health", "/", "/api/tools", "/api/tools/echo/run"]) {
    assert.equal((await s.request(p, { headers: { host: "evil.test" } })).status, 403, p);
  }
});

test("rejects cross-origin POSTs and cross-site fetch metadata, allows same-origin", async () => {
  const s = await start();
  assert.equal((await s.post("echo", { input: "x" }, { origin: "https://evil.test" })).status, 403);
  assert.equal((await s.post("echo", { input: "x" }, { origin: "null" })).status, 403);
  assert.equal((await s.post("echo", { input: "x" }, { "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await s.post("echo", { input: "x" }, { origin: `http://127.0.0.1:${s.port}`, "sec-fetch-site": "same-origin" })).status, 200);
});

test("never emits CORS headers, even for preflight", async () => {
  const s = await start();
  const r = await s.request("/api/tools/echo/run", { method: "OPTIONS", headers: { origin: "https://evil.test", "access-control-request-method": "POST" } });
  assert.equal(r.status, 403);
  assert.equal(r.headers["access-control-allow-origin"], undefined);
  const ok = await s.request("/api/tools/echo/run", { method: "OPTIONS" });
  assert.equal(ok.status, 405);
  assert.equal(ok.headers["access-control-allow-origin"], undefined);
});

test("method and route restrictions", async () => {
  const s = await start();
  const get = await s.request("/api/tools/echo/run");
  assert.equal(get.status, 405);
  assert.match(get.headers.allow, /POST/);
  assert.equal((await s.request("/api/health", { method: "POST", body: "x" })).status, 405);
  assert.equal((await s.request("/api/tools", { method: "POST", body: "x" })).status, 405);
  assert.equal((await s.request("/", { method: "DELETE" })).status, 405);
  assert.equal((await s.request("/api/nope")).status, 404);
  assert.equal((await s.request("/api/compile", { method: "POST", body: "x" })).status, 404);
});

test("rate limiting returns 429 with Retry-After", async () => {
  const s = await start({ env: { TOOLMASTER_RATE_LIMIT_PER_MIN: "3" } });
  for (let i = 0; i < 3; i++) assert.equal((await s.request("/api/health")).status, 200);
  const r = await s.request("/api/health");
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers["retry-after"]) >= 1);
});

test("client disconnect aborts the in-flight job", async () => {
  let aborted;
  const started = Promise.withResolvers();
  const slow = fakeTool({
    manifest: { id: "slow" },
    run: (ctx) => new Promise((_, reject) => {
      started.resolve();
      ctx.signal.addEventListener("abort", () => { aborted = true; reject(new ToolMasterError("TIMEOUT", "cancelled")); });
    }),
  });
  const s = await start({ tools: [slow] });
  const req = http.request({ host: "127.0.0.1", port: s.port, path: "/api/tools/slow/run", method: "POST", headers: { "content-type": "application/json" } });
  req.on("error", () => {});
  req.end(JSON.stringify({ input: "x" }));
  await started.promise;
  req.destroy();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(aborted, true);
});

test("security headers are present on static and error responses too", async () => {
  const s = await start();
  for (const p of ["/", "/api/nope", "/api/health", "/api/tools"]) {
    const r = await s.request(p);
    assert.ok(r.headers["content-security-policy"], p);
    assert.equal(r.headers["x-frame-options"], "DENY", p);
  }
});

test("serverTestTools are valid and distinct", () => {
  assert.equal(new Set(serverTestTools().map((t) => t.manifest.id)).size, 3);
});

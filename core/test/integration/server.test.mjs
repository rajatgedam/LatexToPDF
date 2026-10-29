import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { createToolMaster } from "../../index.mjs";
import { startServer } from "../../server/index.mjs";
import { countPages } from "../../../tools/latex-to-pdf/pdf.mjs";
import { SAMPLE as RESUME } from "../../../tools/latex-to-pdf/sample.mjs";
import { SAMPLE as REPORT } from "../../../tools/latex-to-docx/sample.mjs";

const tm = await createToolMaster({ env: { ...process.env, TOOLMASTER_TIMEOUT_MS: "120000", TOOLMASTER_MAX_CONCURRENCY: "2", TOOLMASTER_RATE_LIMIT_PER_MIN: "1000" } });
const status = await tm.runner.status({ fresh: true });
const skipFor = (id) => (status[id]?.ready ? false : `${id} engine not installed (node bin/toolmaster.mjs install)`);
const FIXTURE = await readFile(new URL("../../../test/fixtures/sample.pdf", import.meta.url));

let srv;
before(async () => {
  srv = await startServer({ config: tm.config, runner: tm.runner, port: 0 });
});
after(() => srv?.close());

const post = (tool, body, type = "application/json", action = "run") =>
  fetch(`${srv.url}/api/tools/${tool}/${action}`, { method: "POST", headers: { "content-type": type }, body: type === "application/json" ? JSON.stringify(body) : body });

test("the catalog lists every tool with readiness; text tools carry a sample input", async () => {
  const j = await (await fetch(`${srv.url}/api/tools`)).json();
  const ids = j.tools.map((t) => t.id);
  for (const id of ["latex-to-pdf", "latex-to-docx", "pdf-pages", "doc-to-markdown"]) assert.ok(ids.includes(id), id);
  for (const t of j.tools) {
    assert.ok(t.useWhen, `${t.id} has a use-when hint`);
    if (t.input.kind === "text") assert.ok(t.sample.length > 50, t.id);
  }
});

test("POST a PDF to pdf-pages with options in the query string returns the rearranged PDF", async () => {
  const res = await fetch(`${srv.url}/api/tools/pdf-pages/run?pages=3,1&rotate=90`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: FIXTURE });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.deepEqual(JSON.parse(res.headers.get("x-toolmaster-meta")), { sourcePages: 3, pages: 2 });
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  const bad = await fetch(`${srv.url}/api/tools/pdf-pages/run?pages=9`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: FIXTURE });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error.message, /the document has 3 pages/);
});

test("POST a PDF to doc-to-markdown returns Markdown text with page markers", async () => {
  const res = await fetch(`${srv.url}/api/tools/doc-to-markdown/run`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: FIXTURE });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/markdown/);
  assert.match(await res.text(), /<!-- page 2 -->\n\nToolMaster fixture page 2/);
});

test("POST the sample resume returns a real one-page PDF", { skip: skipFor("latex-to-pdf") }, async () => {
  const res = await post("latex-to-pdf", { input: RESUME });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(JSON.parse(res.headers.get("x-toolmaster-meta")).pages, 1);
  assert.equal(countPages(Buffer.from(await res.arrayBuffer())), 1);
});

test("POST LaTeX to latex-to-docx returns a DOCX; preview returns HTML", { skip: skipFor("latex-to-docx") }, async () => {
  const res = await post("latex-to-docx", { input: REPORT });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /wordprocessingml\.document$/);
  assert.equal(res.headers.get("content-disposition"), 'attachment; filename="output.docx"');
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 2).toString(), "PK");
  const prev = await post("latex-to-docx", { input: REPORT }, "application/json", "preview");
  assert.equal(prev.status, 200);
  assert.match(prev.headers.get("content-type"), /^text\/html/);
  assert.match(await prev.text(), /Quarterly Report/);
});

test("raw text body with query options works end to end", { skip: skipFor("latex-to-docx") }, async () => {
  const res = await fetch(`${srv.url}/api/tools/latex-to-docx/run?mode=text&toc=false`, { method: "POST", headers: { "content-type": "text/plain" }, body: "Hello from curl." });
  assert.equal(res.status, 200);
});

test("LaTeX errors come back as 422 with a sanitized log", { skip: skipFor("latex-to-pdf") }, async () => {
  const res = await post("latex-to-pdf", { input: "\\documentclass{article}\\begin{document}\\nope\\end{document}" });
  assert.equal(res.status, 422);
  const j = await res.json();
  assert.equal(j.error.code, "TOOL_FAILED");
  assert.match(j.error.log, /Undefined control sequence/);
  assert.ok(!j.error.log.includes("tm-work-"));
});

test("shell-escape payload is refused by the policy layer", { skip: skipFor("latex-to-pdf") }, async () => {
  const res = await post("latex-to-pdf", { input: "\\documentclass{article}\\begin{document}\\immediate\\write18{touch /tmp/tm-pwn}\\end{document}" });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, "POLICY_VIOLATION");
});

test("a burst beyond the concurrency limit yields 503s, never 500s", { skip: skipFor("latex-to-pdf") }, async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => post("latex-to-pdf", "burst", "text/plain")));
  const codes = results.map((r) => r.status);
  assert.ok(codes.includes(200));
  assert.ok(codes.every((c) => c === 200 || c === 503), codes.join(","));
});

test("foreign Host header is rejected over a real socket", async () => {
  const status = await new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: new URL(srv.url).port, path: "/api/health", headers: { host: "evil.test" } }, (r) => { r.resume(); resolve(r.statusCode); });
    req.end();
  });
  assert.equal(status, 403);
});

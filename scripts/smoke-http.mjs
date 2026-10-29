#!/usr/bin/env node
// Smoke-tests a running ToolMaster server (the Docker image in CI): every tool in the catalog must run over HTTP.
//   node scripts/smoke-http.mjs http://127.0.0.1:5757 [expected-tool-count]
// Needs only Node. A tool without a case below fails, so new tools cannot reach an image untested.
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.argv[2] ?? "http://127.0.0.1:5757").replace(/\/$/, "");
const expected = process.argv[3] ? Number(process.argv[3]) : undefined;
const fixture = readFileSync(path.join(root, "test", "fixtures", "sample.pdf"));

const post = (id, { body, type, query = "" }) =>
  fetch(`${base}/api/tools/${id}/run${query}`, { method: "POST", headers: { "content-type": type }, body });
const must = async (res, what) => {
  if (res.status !== 200) throw new Error(`${what}: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
  return Buffer.from(await res.arrayBuffer());
};
const magic = (buf, text) => buf.subarray(0, text.length).toString("latin1") === text;

const CASES = {
  async "latex-to-pdf"(t) {
    const out = await must(await post(t.id, { type: "application/json", body: JSON.stringify({ input: t.sample }) }), t.id);
    if (!magic(out, "%PDF-")) throw new Error("latex-to-pdf did not return a PDF");
  },
  async "latex-to-docx"(t) {
    const out = await must(await post(t.id, { type: "application/json", body: JSON.stringify({ input: t.sample }) }), t.id);
    if (!magic(out, "PK")) throw new Error("latex-to-docx did not return a DOCX");
  },
  async "pdf-pages"(t) {
    const res = await post(t.id, { type: "application/octet-stream", body: fixture, query: "?pages=3,1" });
    const out = await must(res, t.id);
    const meta = JSON.parse(res.headers.get("x-toolmaster-meta") ?? "{}");
    if (!magic(out, "%PDF-") || meta.pages !== 2) throw new Error(`pdf-pages returned ${JSON.stringify(meta)}`);
  },
  async "doc-to-markdown"(t) {
    const out = (await must(await post(t.id, { type: "application/octet-stream", body: fixture }), t.id)).toString("utf8");
    if (!/fixture page 2/.test(out)) throw new Error(`doc-to-markdown returned: ${out.slice(0, 200)}`);
  },
};

const health = await fetch(`${base}/api/health`);
if (!health.ok) throw new Error(`health check failed: HTTP ${health.status}`);
const { tools } = await (await fetch(`${base}/api/tools`)).json();
if (expected !== undefined && tools.length !== expected) throw new Error(`expected ${expected} tools, the server lists ${tools.length}`);
for (const t of tools) {
  if (!t.status.ready) throw new Error(`${t.id} is not ready: ${JSON.stringify(t.status)}`);
  if (!CASES[t.id]) throw new Error(`no HTTP smoke case for tool "${t.id}": add one to scripts/smoke-http.mjs`);
  await CASES[t.id](t);
  console.log(`ok ${t.id}`);
}
// fetch() ignores a custom Host header, so use node:http for this check.
const target = new URL(base);
const evil = await new Promise((resolve, reject) => {
  const req = http.request({ host: target.hostname, port: target.port, path: "/api/health", headers: { host: "evil.test" } }, (res) => {
    res.resume();
    resolve(res.statusCode);
  });
  req.on("error", reject);
  req.end();
});
if (evil !== 403) throw new Error(`a foreign Host header must be refused, got ${evil}`);
console.log("ok host check");

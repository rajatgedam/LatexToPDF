import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { applySecurityHeaders, allowedHostSet, isAllowedHost, isAllowedOrigin, CSP } from "../../server/security.mjs";
import { createRateLimiter } from "../../server/rate-limit.mjs";
import { readBody } from "../../server/body.mjs";

const fakeRes = () => {
  const h = {};
  return { h, setHeader: (k, v) => (h[k.toLowerCase()] = v) };
};

test("security headers cover the baseline set", () => {
  const res = fakeRes();
  applySecurityHeaders(res, { api: true });
  assert.equal(res.h["x-content-type-options"], "nosniff");
  assert.equal(res.h["referrer-policy"], "no-referrer");
  assert.equal(res.h["x-frame-options"], "DENY");
  assert.equal(res.h["cross-origin-opener-policy"], "same-origin");
  assert.equal(res.h["cross-origin-resource-policy"], "same-origin");
  assert.equal(res.h["cache-control"], "no-store");
  assert.match(res.h["permissions-policy"], /camera=\(\)/);
  assert.equal(res.h["content-security-policy"], CSP);
  assert.equal(res.h["access-control-allow-origin"], undefined);
});

test("CSP is strict and allows only same-origin plus blob frames for the preview", () => {
  for (const part of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "frame-src blob:", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'"]) {
    assert.ok(CSP.includes(part), part);
  }
  assert.ok(!CSP.includes("unsafe-eval"));
  assert.ok(!/script-src[^;]*unsafe-inline/.test(CSP));
});

test("non-api responses do not force no-store", () => {
  const res = fakeRes();
  applySecurityHeaders(res, { api: false });
  assert.equal(res.h["cache-control"], undefined);
});

test("host allowlist blocks DNS rebinding", () => {
  const allowed = allowedHostSet(5757, { host: "127.0.0.1", allowedHosts: [] });
  for (const ok of ["127.0.0.1:5757", "localhost:5757", "[::1]:5757", "LOCALHOST:5757"]) assert.equal(isAllowedHost(ok, allowed), true, ok);
  for (const bad of ["evil.test", "evil.test:5757", "127.0.0.1:1", "localhost", "", undefined, "127.0.0.1:5757.evil.test"]) assert.equal(isAllowedHost(bad, allowed), false, String(bad));
});

test("extra allowed hosts are honored", () => {
  const allowed = allowedHostSet(80, { host: "0.0.0.0", allowedHosts: ["my-box.local"] });
  assert.equal(isAllowedHost("my-box.local:80", allowed), true);
  assert.equal(isAllowedHost("0.0.0.0:80", allowed), false);
});

test("origin check: absent is fine, foreign/null/garbage rejected", () => {
  const allowed = allowedHostSet(5757, { host: "127.0.0.1", allowedHosts: [] });
  assert.equal(isAllowedOrigin(undefined, allowed), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:5757", allowed), true);
  assert.equal(isAllowedOrigin("http://localhost:5757", allowed), true);
  assert.equal(isAllowedOrigin("https://evil.test", allowed), false);
  assert.equal(isAllowedOrigin("http://localhost:9999", allowed), false);
  assert.equal(isAllowedOrigin("null", allowed), false);
  assert.equal(isAllowedOrigin("not a url", allowed), false);
});

test("rate limiter: burst up to the limit then refuses with retry-after, refills over time", () => {
  let now = 0;
  const rl = createRateLimiter({ perMin: 3, now: () => now });
  assert.equal(rl.take("a").ok, true);
  assert.equal(rl.take("a").ok, true);
  assert.equal(rl.take("a").ok, true);
  const blocked = rl.take("a");
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec >= 1);
  assert.equal(rl.take("b").ok, true, "keys are independent");
  now += 20_000;
  assert.equal(rl.take("a").ok, true, "refilled after 20 s (3/min)");
});

test("rate limiter bounds memory", () => {
  let now = 0;
  const rl = createRateLimiter({ perMin: 10, now: () => now, maxKeys: 5 });
  for (let i = 0; i < 50; i++) {
    now += 1;
    rl.take(`k${i}`);
  }
  assert.ok(rl.size <= 5);
});

test("readBody returns the bytes within the cap", async () => {
  const req = Object.assign(Readable.from([Buffer.from("ab"), Buffer.from("cd")]), { headers: {} });
  assert.equal((await readBody(req, 10)).toString(), "abcd");
});

test("readBody rejects early on content-length and while streaming", async () => {
  const declared = Object.assign(Readable.from([Buffer.from("x")]), { headers: { "content-length": "999" } });
  await assert.rejects(readBody(declared, 10), { code: "INPUT_TOO_LARGE" });
  const streamed = Object.assign(Readable.from([Buffer.alloc(6), Buffer.alloc(6)]), { headers: {} });
  await assert.rejects(readBody(streamed, 10), { code: "INPUT_TOO_LARGE" });
});

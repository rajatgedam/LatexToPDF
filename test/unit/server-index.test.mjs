import { test } from "node:test";
import assert from "node:assert/strict";
import { browserCommand, startServer } from "../../src/server/index.mjs";
import { loadConfig } from "../../src/config.mjs";
import net from "node:net";

test("browserCommand uses fixed argv per platform (no shell, URL is one argument)", () => {
  assert.deepEqual(browserCommand("darwin", "http://127.0.0.1:1"), { cmd: "open", args: ["http://127.0.0.1:1"] });
  assert.deepEqual(browserCommand("linux", "http://127.0.0.1:1"), { cmd: "xdg-open", args: ["http://127.0.0.1:1"] });
  assert.deepEqual(browserCommand("win32", "http://127.0.0.1:1"), { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", "http://127.0.0.1:1"] });
});

test("browserCommand refuses anything that is not an http loopback URL", () => {
  assert.throws(() => browserCommand("darwin", "file:///etc/passwd"));
  assert.throws(() => browserCommand("darwin", "https://evil.test"));
});

test("startServer binds loopback and returns a usable url; close() stops it", async () => {
  const s = await startServer({ config: loadConfig({ LATEX2PDF_PORT: "" }), port: 0 });
  try {
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(`${s.url}/api/health`);
    assert.equal(res.status, 200);
  } finally {
    await s.close();
  }
  await assert.rejects(fetch(`${s.url}/api/health`));
});

test("falls back to a free port when the preferred default port is busy", async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, "127.0.0.1", r));
  const busy = blocker.address().port;
  const s = await startServer({ config: loadConfig({}), port: busy, fallbackToRandom: true });
  try {
    assert.notEqual(new URL(s.url).port, String(busy));
  } finally {
    await s.close();
    blocker.close();
  }
});

test("an explicitly requested busy port fails loudly", async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, "127.0.0.1", r));
  await assert.rejects(startServer({ config: loadConfig({}), port: blocker.address().port }), { code: "EADDRINUSE" });
  blocker.close();
});

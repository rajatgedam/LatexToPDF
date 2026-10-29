import { test } from "node:test";
import assert from "node:assert/strict";
import { finish } from "../../cli/main.mjs";

test("a numeric result becomes the process exit code", () => {
  const before = process.exitCode;
  try {
    finish(4);
    assert.equal(process.exitCode, 4);
  } finally {
    process.exitCode = before;
  }
});

test("a running server is closed on SIGINT/SIGTERM, then the process exits cleanly", async () => {
  const handlers = {};
  const realOnce = process.once;
  const realExit = process.exit;
  let closed = false;
  let exited;
  process.once = (sig, fn) => ((handlers[sig] = fn), process);
  process.exit = (code) => { exited = code; };
  try {
    finish({ ui: { close: async () => { closed = true; } } });
    assert.deepEqual(Object.keys(handlers).sort(), ["SIGINT", "SIGTERM"]);
    await handlers.SIGTERM();
    assert.equal(closed, true);
    assert.equal(exited, 0);
  } finally {
    process.once = realOnce;
    process.exit = realExit;
  }
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, access, readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createToolMaster } from "../../index.mjs";
import { SANDBOX_EXEC } from "../../sandbox.mjs";
import { fakeTool } from "../../../test/helpers/fake-tool.mjs";

const hasSandbox = await access(SANDBOX_EXEC).then(() => true, () => false);
const opts = { skip: hasSandbox ? false : "no OS sandbox on this platform" };

// Stand-in for a compromised parser: it tries everything a malicious PDF might make a JS library do.
const EVIL = `
const fs = require("node:fs");
const net = require("node:net");
const attempt = (fn) => { try { fn(); return "allowed"; } catch (e) { return e.code || "error"; } };
const [port, home, target] = JSON.parse(fs.readFileSync("request.json", "utf8")).probe;
const result = {
  readHome: attempt(() => fs.readFileSync(home)),
  writeOutside: attempt(() => fs.writeFileSync(target, "pwned")),
  listUsers: attempt(() => fs.readdirSync("/Users")),
};
const sock = net.connect(Number(port), "127.0.0.1");
const finish = (net) => { result.network = net; fs.writeFileSync("result.json", JSON.stringify({ result })); process.exit(0); };
sock.on("connect", () => finish("allowed"));
sock.on("error", (e) => finish(e.code || "error"));
setTimeout(() => finish("timeout"), 3000);
`;

let dir;
let server;
let port;
let tm;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tm-isosbx-"));
  await writeFile(path.join(dir, "worker.cjs"), EVIL);
  server = http.createServer((_q, r) => r.end("hi"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  const tool = fakeTool({
    manifest: { id: "probe" },
    run: async (ctx, { input }) => ({ data: Buffer.from(JSON.stringify((await ctx.isolate({ job: "x", request: { probe: JSON.parse(input) } })).result)) }),
  });
  tm = await createToolMaster({
    env: { TOOLMASTER_SANDBOX: "on" },
    projectRoot: dir,
    tools: [tool],
    self: { command: process.execPath, args: [path.join(dir, "worker.cjs")], ro: [dir] },
  });
});
after(async () => {
  server?.close();
  await rm(dir, { recursive: true, force: true });
});

test("an isolated worker cannot read the home folder, write outside its folder, list /Users or reach the network", opts, async () => {
  const home = path.join(os.homedir(), ".zshrc");
  const target = path.join(dir, "outside.txt");
  const probe = JSON.stringify([String(port), home, target]);
  const r = JSON.parse((await tm.runner.run("probe", { input: probe })).data.toString());
  assert.equal(r.readHome, "EPERM");
  assert.equal(r.writeOutside, "EPERM");
  assert.equal(r.listUsers, "EPERM");
  assert.notEqual(r.network, "allowed");
  await assert.rejects(readFile(target), { code: "ENOENT" });
});

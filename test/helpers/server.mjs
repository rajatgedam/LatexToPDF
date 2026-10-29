import http from "node:http";
import { loadConfig } from "../../src/config.mjs";
import { createApp, listen } from "../../src/server/app.mjs";

/** Start the app on an ephemeral port with an injected compiler. */
export async function startTestServer({ compile, env = {}, webRoot = "/nonexistent" } = {}) {
  const config = loadConfig({ LATEX2PDF_PORT: "", ...env });
  const compiler = { config, compile: compile ?? (async () => ({ pdf: Buffer.from("%PDF-1.5 fake"), pages: 1, durationMs: 7, warnings: [], kind: "latex" })) };
  const server = createApp({ config, compiler, webRoot });
  const { port } = await listen(server, { host: "127.0.0.1", port: 0 });
  const request = (path, { method = "GET", headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks), text: Buffer.concat(chunks).toString(), json: () => JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.on("error", reject);
      req.end(body);
    });
  const post = (body, headers = {}) =>
    request("/api/compile", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { port, server, request, post, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

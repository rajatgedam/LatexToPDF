import http from "node:http";
import { createToolMaster } from "../../core/index.mjs";
import { createApp, listen } from "../../core/server/app.mjs";
import { fakeTool } from "./fake-tool.mjs";

const PDF = Buffer.from("%PDF-1.5 fake");

/** Tools used by server tests: a text->pdf echo with a file preview, and a binary tool. */
export const serverTestTools = () => [
  fakeTool({
    manifest: {
      id: "echo",
      name: "Echo",
      category: "testing",
      input: { kind: "text", accept: [".txt"] },
      output: { contentType: "application/pdf", extension: "pdf" },
      preview: "file",
      options: [{ id: "mode", label: "Mode", type: "enum", values: ["a", "b"], default: "a" }],
      sample: "sample",
      engines: [],
    },
    run: async (_ctx, { input, options }) => ({ data: Buffer.concat([PDF, Buffer.from(`|${input}|${options.mode}`)]), meta: { pages: 2, note: "café" }, warnings: ["w1"] }),
  }),
  fakeTool({
    manifest: { id: "blob", name: "Blob", category: "testing", input: { kind: "binary", accept: [".bin"] }, output: { contentType: "application/octet-stream", extension: "bin" } },
    run: async (_ctx, { input }) => ({ data: Buffer.from(input).reverse(), meta: {} }),
  }),
  fakeTool({
    manifest: { id: "htmlish", name: "Htmlish", category: "testing", preview: "html", output: { contentType: "text/plain", extension: "txt" } },
    run: async (_ctx, { input }) => ({ data: Buffer.from(input) }),
    preview: async (_ctx, { input }) => ({ data: Buffer.from(`<p>${input}</p>`), contentType: "text/html; charset=utf-8" }),
  }),
];

/** Start the app on an ephemeral port. Pass `tools` to control what is registered. */
export async function startTestServer({ tools = serverTestTools(), env = {}, webRoot = "/nonexistent" } = {}) {
  const tm = await createToolMaster({ env: { TOOLMASTER_PORT: "", TOOLMASTER_SANDBOX: "off", ...env }, projectRoot: "/tmp/tm-server-test", tools });
  const server = createApp({ config: tm.config, runner: tm.runner, webRoot });
  const { port } = await listen(server, { host: "127.0.0.1", port: 0 });
  const request = (path, { method = "GET", headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, buffer, text: buffer.toString(), json: () => JSON.parse(buffer.toString()) });
        });
      });
      req.on("error", reject);
      req.end(body);
    });
  const post = (toolId, body, headers = {}, action = "run") =>
    request(`/api/tools/${toolId}/${action}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  return { port, server, tm, request, post, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

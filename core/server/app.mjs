import http from "node:http";
import path from "node:path";
import { ToolMasterError } from "../errors.mjs";
import { inputLimit } from "../runner.mjs";
import { applySecurityHeaders, allowedHostSet, isAllowedHost, isAllowedOrigin } from "./security.mjs";
import { createRateLimiter } from "./rate-limit.mjs";
import { readBody } from "./body.mjs";
import { createStaticHandler } from "./static.mjs";

const STATUS = {
  INPUT_EMPTY: 400, INPUT_INVALID: 400, INPUT_TOO_LARGE: 413, TOOL_NOT_FOUND: 404, POLICY_VIOLATION: 422, TOOL_FAILED: 422,
  OUTPUT_TOO_LARGE: 422, TIMEOUT: 504, BUSY: 503, ENGINE_NOT_FOUND: 503,
};
const TOOL_ROUTE = /^\/api\/tools\/([a-z][a-z0-9-]{0,39})\/(run|preview)$/;
const PUBLIC_FIELDS = ["id", "name", "description", "useWhen", "category", "icon", "tags", "version", "input", "output", "preview", "options", "ui", "sample"];

const asciiJson = (value) => JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(body));
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

const sendError = (res, status, code, message, headers) => sendJson(res, status, { error: { code, message } }, headers);

function sendToolError(res, err) {
  if (!(err instanceof ToolMasterError)) {
    console.error(`[toolmaster] unexpected error: ${err?.name ?? "Error"}`);
    return sendError(res, 500, "INTERNAL", "Internal error");
  }
  return sendJson(res, STATUS[err.code] ?? 500, { error: err.toJSON() }, err.code === "BUSY" ? { "retry-after": "2" } : {});
}

const publicManifest = (manifest) => Object.fromEntries(PUBLIC_FIELDS.filter((k) => manifest[k] !== undefined).map((k) => [k, manifest[k]]));

async function parseToolRequest(req, url, manifest, config) {
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const limit = inputLimit(manifest, config);
  const queryOptions = Object.fromEntries(url.searchParams);

  if (type === "application/json" && manifest.input.kind === "text") {
    const raw = await readBody(req, limit * 2 + 1024);
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    } catch {
      throw new ToolMasterError("INPUT_INVALID", "Body is not valid UTF-8 JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new ToolMasterError("INPUT_INVALID", "JSON body must be an object");
    if (typeof parsed.input !== "string") throw new ToolMasterError("INPUT_INVALID", "`input` must be a string");
    return { input: parsed.input, options: parsed.options ?? {} };
  }

  const rawText = manifest.input.kind === "text" && (type.startsWith("text/") || type === "application/x-tex");
  const rawBinary = manifest.input.kind === "binary" && type === "application/octet-stream";
  if (!rawText && !rawBinary) throw Object.assign(new Error("unsupported"), { status: 415 });
  const raw = await readBody(req, limit);
  if (rawBinary) return { input: raw, options: queryOptions };
  try {
    return { input: new TextDecoder("utf-8", { fatal: true }).decode(raw), options: queryOptions };
  } catch {
    throw new ToolMasterError("INPUT_INVALID", "Body is not valid UTF-8");
  }
}

/** Build the HTTP server (not yet listening). `runner` is a core runner; the server knows nothing about specific tools. */
export function createApp({ config, runner, webRoot = path.join(config.projectRoot, "web", "dist") }) {
  const limiter = createRateLimiter({ perMin: config.rateLimitPerMin });
  const serveStatic = createStaticHandler(webRoot);

  async function handle(req, res) {
    const url = (req.url ?? "").startsWith("/") ? new URL(req.url, "http://localhost") : null;
    const pathname = url?.pathname ?? null;
    const isApi = pathname?.startsWith("/api/") ?? false;
    applySecurityHeaders(res, { api: isApi });
    if (pathname === null) return sendError(res, 400, "BAD_REQUEST", "Bad request");

    const allowed = allowedHostSet(server.address()?.port, config);
    if (!isAllowedHost(req.headers.host, allowed)) return sendError(res, 403, "FORBIDDEN_HOST", "Host not allowed");

    const verdict = limiter.take(req.socket.remoteAddress ?? "unknown");
    if (!verdict.ok) return sendError(res, 429, "RATE_LIMITED", "Too many requests", { "retry-after": String(verdict.retryAfterSec) });

    const safeMethod = req.method === "GET" || req.method === "HEAD";
    if (!safeMethod && (!isAllowedOrigin(req.headers.origin, allowed) || req.headers["sec-fetch-site"] === "cross-site")) {
      return sendError(res, 403, "FORBIDDEN_ORIGIN", "Cross-origin requests are not allowed");
    }

    if (pathname === "/api/health") {
      if (!safeMethod) return sendError(res, 405, "METHOD_NOT_ALLOWED", "Use GET", { allow: "GET, HEAD" });
      return sendJson(res, 200, { ok: true, tools: await runner.status() });
    }
    if (pathname === "/api/tools") {
      if (!safeMethod) return sendError(res, 405, "METHOD_NOT_ALLOWED", "Use GET", { allow: "GET, HEAD" });
      const status = await runner.status();
      return sendJson(res, 200, { tools: runner.registry.list().map((t) => ({ ...publicManifest(t.manifest), status: status[t.manifest.id] })) });
    }
    const route = TOOL_ROUTE.exec(pathname);
    if (route) {
      if (req.method !== "POST") return sendError(res, 405, "METHOD_NOT_ALLOWED", "Use POST", { allow: "POST" });
      return runTool(req, res, url, route[1], route[2]);
    }
    if (isApi) return sendError(res, 404, "NOT_FOUND", "Not found");
    if (!safeMethod) return sendError(res, 405, "METHOD_NOT_ALLOWED", "Use GET", { allow: "GET, HEAD" });
    await serveStatic(req, res, pathname);
  }

  async function runTool(req, res, url, toolId, action) {
    const ac = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) ac.abort();
    });
    try {
      const { manifest } = runner.registry.get(toolId);
      const { input, options } = await parseToolRequest(req, url, manifest, config);
      const result = await runner[action](toolId, { input, options, signal: ac.signal });
      if (ac.signal.aborted) return;
      res.statusCode = 200;
      res.setHeader("content-type", result.contentType);
      res.setHeader("content-length", result.data.length);
      res.setHeader("x-toolmaster-duration-ms", String(result.durationMs));
      if (action === "run") {
        res.setHeader("content-disposition", `${manifest.preview === "file" ? "inline" : "attachment"}; filename="output.${result.extension}"`);
        res.setHeader("x-toolmaster-meta", asciiJson(result.meta));
        res.setHeader("x-toolmaster-warnings", String(result.warnings.length));
      }
      res.end(result.data);
    } catch (err) {
      if (ac.signal.aborted) return;
      if (err?.status === 415) return sendError(res, 415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json, text/plain or application/octet-stream as the tool expects");
      sendToolError(res, err);
    }
  }

  const server = http.createServer({ maxHeaderSize: 16_384 }, (req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) sendToolError(res, err);
      else res.destroy();
    });
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

/** Listen on host:port; optionally fall back to a random free port if the preferred one is busy. */
export function listen(server, { host, port, fallbackToRandom = false }) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === "EADDRINUSE" && fallbackToRandom && port !== 0) server.listen(0, host);
      else {
        server.off("listening", onListening);
        reject(err);
      }
    };
    const onListening = () => {
      server.off("error", onError);
      resolve({ host, port: server.address().port });
    };
    server.on("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

import http from "node:http";
import path from "node:path";
import { LatexToPdfError } from "../errors.mjs";
import { engineInfo } from "../engine.mjs";
import { applySecurityHeaders, allowedHostSet, isAllowedHost, isAllowedOrigin } from "./security.mjs";
import { createRateLimiter } from "./rate-limit.mjs";
import { readBody } from "./body.mjs";
import { createStaticHandler } from "./static.mjs";

const STATUS = {
  INPUT_EMPTY: 400, INPUT_INVALID: 400, INPUT_TOO_LARGE: 413, POLICY_VIOLATION: 422, COMPILE_FAILED: 422,
  OUTPUT_TOO_LARGE: 422, TIMEOUT: 504, BUSY: 503, ENGINE_NOT_FOUND: 503,
};
const JSON_TYPES = new Set(["application/json"]);
const TEXT_TYPES = new Set(["text/plain", "application/x-tex", "text/x-tex"]);
const HEALTH_TTL_MS = 30_000;

function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(body));
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

const sendError = (res, status, code, message, headers) => sendJson(res, status, { error: { code, message } }, headers);

function sendCompileError(res, err) {
  if (!(err instanceof LatexToPdfError)) {
    console.error(`[latex2pdf] unexpected error: ${err?.name ?? "Error"}`);
    return sendError(res, 500, "INTERNAL", "Internal error");
  }
  const status = STATUS[err.code] ?? 500;
  return sendJson(res, status, { error: err.toJSON() }, err.code === "BUSY" ? { "retry-after": "2" } : {});
}

async function parseCompileRequest(req, config) {
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const isJson = JSON_TYPES.has(type);
  if (!isJson && !TEXT_TYPES.has(type)) throw Object.assign(new Error("unsupported"), { status: 415 });
  const raw = await readBody(req, isJson ? config.maxInputBytes * 2 + 1024 : config.maxInputBytes);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new LatexToPdfError("INPUT_INVALID", "Body is not valid UTF-8");
  }
  if (!isJson) return { source: text };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LatexToPdfError("INPUT_INVALID", "Body is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new LatexToPdfError("INPUT_INVALID", "JSON body must be an object");
  if (typeof parsed.source !== "string") throw new LatexToPdfError("INPUT_INVALID", "`source` must be a string");
  if (parsed.mode !== undefined && typeof parsed.mode !== "string") throw new LatexToPdfError("INPUT_INVALID", "`mode` must be a string");
  return { source: parsed.source, mode: parsed.mode };
}

/** Build the HTTP server (not yet listening). `compiler` needs `{ config, compile }`. */
export function createApp({ config, compiler, webRoot = path.join(config.projectRoot, "web", "dist") }) {
  const limiter = createRateLimiter({ perMin: config.rateLimitPerMin });
  const serveStatic = createStaticHandler(webRoot);
  let healthCache = null;

  async function health() {
    if (!healthCache || Date.now() - healthCache.at > HEALTH_TTL_MS) {
      const { path: _omit, ...engine } = await engineInfo(config);
      healthCache = { at: Date.now(), engine };
    }
    return { ok: true, engine: healthCache.engine };
  }

  async function handle(req, res) {
    const pathname = (req.url ?? "").startsWith("/") ? new URL(req.url, "http://localhost").pathname : null;
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
      return sendJson(res, 200, await health());
    }
    if (pathname === "/api/compile") {
      if (req.method !== "POST") return sendError(res, 405, "METHOD_NOT_ALLOWED", "Use POST", { allow: "POST" });
      return compile(req, res);
    }
    if (isApi) return sendError(res, 404, "NOT_FOUND", "Not found");
    if (!safeMethod) return sendError(res, 405, "METHOD_NOT_ALLOWED", "Use GET", { allow: "GET, HEAD" });
    await serveStatic(req, res, pathname);
  }

  async function compile(req, res) {
    const ac = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) ac.abort();
    });
    try {
      const { source, mode } = await parseCompileRequest(req, config);
      const result = await compiler.compile({ source, mode, signal: ac.signal });
      if (ac.signal.aborted) return;
      res.statusCode = 200;
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", 'inline; filename="resume.pdf"');
      res.setHeader("content-length", result.pdf.length);
      res.setHeader("x-latex2pdf-pages", String(result.pages));
      res.setHeader("x-latex2pdf-duration-ms", String(result.durationMs));
      res.end(result.pdf);
    } catch (err) {
      if (ac.signal.aborted) return;
      if (err?.status === 415) return sendError(res, 415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json, text/plain or application/x-tex");
      sendCompileError(res, err);
    }
  }

  const server = http.createServer({ maxHeaderSize: 16_384 }, (req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) sendCompileError(res, err);
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

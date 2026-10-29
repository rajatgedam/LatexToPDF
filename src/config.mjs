import path from "node:path";
import { fileURLToPath } from "node:url";
import { LatexToPdfError } from "./errors.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const INT_MAX = 2 ** 31 - 1;

function int(env, name, fallback, max = INT_MAX) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d{1,10}$/.test(raw)) throw new LatexToPdfError("CONFIG_INVALID", `${name} must be a positive integer`);
  const n = Number(raw);
  if (n < 1 || n > max) throw new LatexToPdfError("CONFIG_INVALID", `${name} must be between 1 and ${max}`);
  return n;
}

/** Build a validated, frozen config from environment variables (12-factor). */
export function loadConfig(env = process.env, { projectRoot = DEFAULT_ROOT } = {}) {
  const host = env.LATEX2PDF_HOST || "127.0.0.1";
  const allowRemote = env.LATEX2PDF_ALLOW_REMOTE === "1";
  if (!LOOPBACK.has(host) && !allowRemote) {
    throw new LatexToPdfError("CONFIG_INVALID", "Non-loopback LATEX2PDF_HOST requires LATEX2PDF_ALLOW_REMOTE=1");
  }
  const sandbox = env.LATEX2PDF_SANDBOX || "auto";
  if (!["auto", "on", "off"].includes(sandbox)) throw new LatexToPdfError("CONFIG_INVALID", "LATEX2PDF_SANDBOX must be auto, on or off");
  return Object.freeze({
    projectRoot,
    host,
    allowRemote,
    allowedHosts: (env.LATEX2PDF_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
    port: int(env, "LATEX2PDF_PORT", 5757, 65535),
    portExplicit: Boolean(env.LATEX2PDF_PORT),
    maxInputBytes: int(env, "LATEX2PDF_MAX_INPUT_BYTES", 1_048_576),
    maxOutputBytes: int(env, "LATEX2PDF_MAX_OUTPUT_BYTES", 26_214_400),
    timeoutMs: int(env, "LATEX2PDF_TIMEOUT_MS", 60_000, 3_600_000),
    maxConcurrency: int(env, "LATEX2PDF_MAX_CONCURRENCY", 2, 64),
    rateLimitPerMin: int(env, "LATEX2PDF_RATE_LIMIT_PER_MIN", 60, 100_000),
    enginePath: env.LATEX2PDF_ENGINE || null,
    offline: env.LATEX2PDF_OFFLINE === "1",
    sandbox,
    cacheDir: env.TECTONIC_CACHE_DIR || path.join(projectRoot, "vendor", "tectonic-cache"),
  });
}

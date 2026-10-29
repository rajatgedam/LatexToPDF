import path from "node:path";
import { fileURLToPath } from "node:url";
import { ToolMasterError } from "./errors.mjs";

// import.meta.url is unavailable in the bundled single-file executable; callers pass projectRoot there.
const DEFAULT_ROOT = (() => {
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  } catch {
    return process.cwd();
  }
})();
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const INT_MAX = 2 ** 31 - 1;
const ENGINE_PREFIX = "TOOLMASTER_ENGINE_";

function int(env, name, fallback, max = INT_MAX) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d{1,10}$/.test(raw)) throw new ToolMasterError("CONFIG_INVALID", `${name} must be a positive integer`);
  const n = Number(raw);
  if (n < 1 || n > max) throw new ToolMasterError("CONFIG_INVALID", `${name} must be between 1 and ${max}`);
  return n;
}

const list = (raw) => (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/** TOOLMASTER_ENGINE_PANDOC=/path -> { pandoc: "/path" } (underscores in the id map to dashes). */
function engineOverrides(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(ENGINE_PREFIX) && value) out[key.slice(ENGINE_PREFIX.length).toLowerCase().replace(/_/g, "-")] = value;
  }
  return out;
}

/** Folder of the program's own source (engine specs live in `<root>/engines`); `projectRoot` is where vendor/ and web/ live. */
export const SOURCE_ROOT = DEFAULT_ROOT;

/**
 * How to start another copy of this program as an isolated worker: `{ command, args, ro }`. `ro` lists extra folders the
 * worker may read under the OS sandbox (the source tree when running from source; nothing for the single-file executable).
 */
export const defaultSelf = () => ({ command: process.execPath, args: [path.join(DEFAULT_ROOT, "core", "worker-entry.mjs")], ro: [DEFAULT_ROOT] });

/** Build a validated, frozen config from environment variables (12-factor). */
export function loadConfig(env = process.env, { projectRoot = DEFAULT_ROOT, self = defaultSelf() } = {}) {
  const host = env.TOOLMASTER_HOST || "127.0.0.1";
  const allowRemote = env.TOOLMASTER_ALLOW_REMOTE === "1";
  if (!LOOPBACK.has(host) && !allowRemote) {
    throw new ToolMasterError("CONFIG_INVALID", "Non-loopback TOOLMASTER_HOST requires TOOLMASTER_ALLOW_REMOTE=1");
  }
  const sandbox = env.TOOLMASTER_SANDBOX || "auto";
  if (!["auto", "on", "off"].includes(sandbox)) throw new ToolMasterError("CONFIG_INVALID", "TOOLMASTER_SANDBOX must be auto, on or off");
  const packDir = path.join(projectRoot, "vendor");
  const vendorDir = env.TOOLMASTER_VENDOR_DIR ? path.resolve(env.TOOLMASTER_VENDOR_DIR) : packDir;
  return Object.freeze({
    projectRoot,
    vendorDir,
    packDir,
    self: Object.freeze(self),
    cacheRoot: env.TOOLMASTER_CACHE_DIR || path.join(vendorDir, "cache"),
    host,
    allowRemote,
    allowedHosts: list(env.TOOLMASTER_ALLOWED_HOSTS),
    port: int(env, "TOOLMASTER_PORT", 5757, 65535),
    portExplicit: Boolean(env.TOOLMASTER_PORT),
    maxInputBytes: int(env, "TOOLMASTER_MAX_INPUT_BYTES", 1_048_576),
    maxOutputBytes: int(env, "TOOLMASTER_MAX_OUTPUT_BYTES", 26_214_400),
    timeoutMs: int(env, "TOOLMASTER_TIMEOUT_MS", 60_000, 3_600_000),
    maxConcurrency: int(env, "TOOLMASTER_MAX_CONCURRENCY", 2, 64),
    rateLimitPerMin: int(env, "TOOLMASTER_RATE_LIMIT_PER_MIN", 60, 100_000),
    offline: env.TOOLMASTER_OFFLINE === "1",
    sandbox,
    enabledTools: env.TOOLMASTER_TOOLS ? list(env.TOOLMASTER_TOOLS) : null,
    engineOverrides: Object.freeze(engineOverrides(env)),
  });
}

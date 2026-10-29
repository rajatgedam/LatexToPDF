import { spawn, execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, stat, rm, mkdir, access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LatexToPdfError } from "./errors.mjs";

const IS_WIN = process.platform === "win32";
const MAX_LOG_CHARS = 256 * 1024;

const isExecutable = (p) => access(p, IS_WIN ? constants.F_OK : constants.X_OK).then(() => true, () => false);

/** Locate the engine binary: explicit config > vendor/ > PATH. */
export async function resolveEngine(config) {
  if (config.enginePath) {
    if (await isExecutable(config.enginePath)) return config.enginePath;
    throw new LatexToPdfError("ENGINE_NOT_FOUND", "LATEX2PDF_ENGINE does not point to an executable file");
  }
  const exe = IS_WIN ? "tectonic.exe" : "tectonic";
  const candidates = [
    path.join(config.projectRoot, "vendor", "tectonic", exe),
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((d) => path.join(d, exe)),
  ];
  for (const c of candidates) if (await isExecutable(c)) return c;
  throw new LatexToPdfError("ENGINE_NOT_FOUND", "Tectonic engine not found. Run `npm run install:engine`.");
}

/** Report whether the engine is usable, with its version string. */
export async function engineInfo(config) {
  const enginePath = await resolveEngine(config).catch(() => null);
  if (!enginePath) return { found: false };
  const version = await new Promise((resolve) => {
    execFile(enginePath, ["--version"], { timeout: 10_000, env: { PATH: "/usr/bin:/bin" } }, (err, stdout) => resolve(err ? null : stdout.trim()));
  });
  return version ? { found: true, version, path: enginePath } : { found: false };
}

function childEnv(config, workdir) {
  const env = {
    PATH: IS_WIN ? (process.env.PATH ?? "") : "/usr/bin:/bin",
    HOME: process.env.HOME ?? workdir,
    LANG: "en_US.UTF-8",
    TMPDIR: workdir,
    TECTONIC_CACHE_DIR: config.cacheDir,
  };
  if (IS_WIN) for (const k of ["SystemRoot", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) if (process.env[k]) env[k] = process.env[k];
  return env;
}

function killTree(child) {
  try {
    if (IS_WIN) child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    // already exited
  }
}

function execute(engine, args, { cwd, env, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(engine, args, { cwd, env, detached: !IS_WIN, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let log = "";
    let reason = null;
    const onData = (chunk) => {
      if (log.length < MAX_LOG_CHARS) log = (log + chunk).slice(0, MAX_LOG_CHARS);
    };
    child.stdout.setEncoding("utf8").on("data", onData);
    child.stderr.setEncoding("utf8").on("data", onData);

    const stop = (why) => {
      if (reason) return;
      reason = why;
      killTree(child);
    };
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    const onAbort = () => stop("abort");
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    child.once("error", (err) => {
      clearTimeout(timer);
      reject(new LatexToPdfError("ENGINE_NOT_FOUND", "Could not start the engine", { cause: err }));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, log, reason });
    });
  });
}

async function sanitizer(workdir) {
  const roots = [workdir, await realpath(workdir).catch(() => workdir)];
  const home = os.homedir();
  return (text) => {
    let out = text;
    for (const r of roots) out = out.split(r).join("<work>");
    return home && home !== "/" ? out.split(home).join("~") : out;
  };
}

const firstError = (log) => (log.match(/^(?:error:|!).*$/m)?.[0] ?? "").slice(0, 200);
const TAIL_CHARS = 20_000;
const tail = (log) => (log.length > TAIL_CHARS ? `...(truncated)\n${log.slice(-TAIL_CHARS)}` : log);

/**
 * Compile a complete LaTeX document in an isolated temp dir.
 * @returns {Promise<{ pdf: Buffer, log: string }>}
 */
export async function runEngine({ tex, config, timeoutMs = config.timeoutMs, signal, tmpRoot = os.tmpdir() }) {
  const engine = await resolveEngine(config);
  await mkdir(config.cacheDir, { recursive: true });
  const workdir = await mkdtemp(path.join(tmpRoot, "l2p-work-"));
  try {
    await writeFile(path.join(workdir, "main.tex"), tex, { flag: "wx", mode: 0o600 });
    const args = ["-X", "compile", "--untrusted", "--print", "--outdir", workdir, ...(config.offline ? ["--only-cached"] : []), "main.tex"];
    const scrub = await sanitizer(workdir);
    const { code, log: rawLog, reason } = await execute(engine, args, { cwd: workdir, env: childEnv(config, workdir), timeoutMs, signal });
    const log = scrub(rawLog);

    if (reason) throw new LatexToPdfError("TIMEOUT", reason === "timeout" ? `Compilation exceeded ${timeoutMs} ms` : "Compilation cancelled", { log: tail(log) });

    const pdfPath = path.join(workdir, "main.pdf");
    const info = code === 0 ? await stat(pdfPath).catch(() => null) : null;
    if (!info?.isFile()) {
      const hint = firstError(log);
      throw new LatexToPdfError("COMPILE_FAILED", hint ? `Compilation failed: ${hint}` : "Compilation failed", { log: tail(log) });
    }
    if (info.size > config.maxOutputBytes) throw new LatexToPdfError("OUTPUT_TOO_LARGE", `PDF exceeds ${config.maxOutputBytes} bytes`, { log });
    const pdf = await readFile(pdfPath);
    if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new LatexToPdfError("COMPILE_FAILED", "Engine did not produce a valid PDF", { log });
    return { pdf, log };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

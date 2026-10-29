import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, stat, rm, mkdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ToolMasterError } from "./errors.mjs";
import { wrapWithSandbox } from "./sandbox.mjs";

const IS_WIN = process.platform === "win32";
const MAX_LOG_CHARS = 256 * 1024;
const TAIL_CHARS = 20_000;
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const DEFAULT_ERROR = /^(?:error:|!|pandoc:|fatal).*$/im;

const tail = (log) => (log.length > TAIL_CHARS ? `...(truncated)\n${log.slice(-TAIL_CHARS)}` : log);

function childEnv(workdir, extra) {
  const env = {
    PATH: IS_WIN ? (process.env.PATH ?? "") : "/usr/bin:/bin",
    HOME: process.env.HOME ?? workdir,
    LANG: "en_US.UTF-8",
    TMPDIR: workdir,
  };
  if (IS_WIN) for (const k of ["SystemRoot", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) if (process.env[k]) env[k] = process.env[k];
  return { ...env, ...extra };
}

function killTree(child) {
  try {
    if (IS_WIN) child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    // already exited
  }
}

function execute(cmd, args, { cwd, env, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, detached: !IS_WIN, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
      reject(new ToolMasterError("ENGINE_NOT_FOUND", "Could not start the engine", { cause: err }));
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

/**
 * Run an engine in an isolated temp dir: files in, files out, scrubbed env, timeout with process-group kill,
 * output/log caps, optional OS sandbox. Everything a tool needs to shell out safely lives here.
 * @returns {Promise<{ outputs: Record<string, Buffer>, log: string, code: number }>}
 */
export async function runProcess({
  command, args, files = {}, env = {}, outputs = [], config, timeoutMs = config.timeoutMs, signal,
  rw = [], network = true, maxOutputBytes = config.maxOutputBytes, errorPattern = DEFAULT_ERROR, label = "The engine", tmpRoot = os.tmpdir(),
}) {
  for (const name of [...Object.keys(files), ...outputs]) if (!SAFE_NAME.test(name)) throw new ToolMasterError("INPUT_INVALID", `Unsafe file name "${name}"`);
  await Promise.all(rw.map((dir) => mkdir(dir, { recursive: true })));
  const workdir = await mkdtemp(path.join(tmpRoot, "tm-work-"));
  try {
    for (const [name, content] of Object.entries(files)) await writeFile(path.join(workdir, name), content, { flag: "wx", mode: 0o600 });
    const argv = typeof args === "function" ? args(workdir) : args;
    const scrub = await sanitizer(workdir);
    const run = await wrapWithSandbox({ command, args: argv, workdir, rw, network, config });
    const { code, log: rawLog, reason } = await execute(run.cmd, run.args, { cwd: workdir, env: childEnv(workdir, env), timeoutMs, signal });
    const log = scrub(rawLog);

    if (reason) throw new ToolMasterError("TIMEOUT", reason === "timeout" ? `${label} exceeded ${timeoutMs} ms` : "Cancelled", { log: tail(log) });

    const fail = () => {
      const hint = (log.match(errorPattern)?.[0] ?? "").slice(0, 200);
      return new ToolMasterError("TOOL_FAILED", hint ? `${label} failed: ${hint}` : `${label} failed`, { log: tail(log) });
    };
    if (code !== 0) throw fail();

    const found = {};
    for (const name of outputs) {
      const info = await stat(path.join(workdir, name)).catch(() => null);
      if (!info?.isFile()) throw fail();
      if (info.size > maxOutputBytes) throw new ToolMasterError("OUTPUT_TOO_LARGE", `Output exceeds ${maxOutputBytes} bytes`, { log: tail(log) });
      found[name] = await readFile(path.join(workdir, name));
    }
    return { outputs: found, log, code };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

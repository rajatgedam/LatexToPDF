import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { LatexToPdfError } from "./errors.mjs";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/** macOS Seatbelt profile: later rules win, so deny broadly then re-allow the work/cache/engine dirs. */
export function sandboxProfile({ offline }) {
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    '(allow file-write* (subpath (param "WORK")) (subpath (param "CACHE")) (literal "/dev/null") (literal "/dev/dtracehelper"))',
    '(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/private/var/root"))',
    '(allow file-read* (subpath (param "WORK")) (subpath (param "CACHE")) (subpath (param "ENGINE_DIR")))',
    ...(offline ? ["(deny network*)"] : []),
  ].join("\n");
}

export function buildSandboxArgv({ engine, engineArgs, work, cache, engineDir, offline }) {
  return {
    cmd: SANDBOX_EXEC,
    args: ["-D", `WORK=${work}`, "-D", `CACHE=${cache}`, "-D", `ENGINE_DIR=${engineDir}`, "-p", sandboxProfile({ offline }), engine, ...engineArgs],
  };
}

const available = (platform) => (platform === "darwin" ? access(SANDBOX_EXEC, constants.X_OK).then(() => true, () => false) : Promise.resolve(false));

/** Wrap the engine command in an OS sandbox when configured and supported (macOS only for now). */
export async function wrapWithSandbox({ engine, engineArgs, workdir, config, platform = process.platform }) {
  const plain = { cmd: engine, args: engineArgs, sandboxed: false };
  if (config.sandbox === "off") return plain;
  if (!(await available(platform))) {
    if (config.sandbox === "on") throw new LatexToPdfError("CONFIG_INVALID", "LATEX2PDF_SANDBOX=on but no OS sandbox is available on this platform");
    return plain;
  }
  const [work, cache, engineReal] = await Promise.all([realpath(workdir), realpath(config.cacheDir), realpath(engine)]);
  return { ...buildSandboxArgv({ engine, engineArgs, work, cache, engineDir: path.dirname(engineReal), offline: config.offline }), sandboxed: true };
}

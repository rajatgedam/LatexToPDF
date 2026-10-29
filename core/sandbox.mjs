import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { ToolMasterError } from "./errors.mjs";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

const rwParams = (count) => Array.from({ length: count }, (_, i) => `RW${i}`);

/** macOS Seatbelt profile: later rules win, so deny broadly then re-allow the work/rw/engine dirs. Only fixed names are interpolated. */
export function sandboxProfile({ network = true, rwCount = 0 } = {}) {
  const rw = rwParams(rwCount).map((p) => ` (subpath (param "${p}"))`).join("");
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (subpath (param "WORK"))${rw} (literal "/dev/null") (literal "/dev/dtracehelper"))`,
    '(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/private/var/root"))',
    `(allow file-read* (subpath (param "WORK"))${rw} (subpath (param "ENGINE_DIR")))`,
    ...(network ? [] : ["(deny network*)"]),
  ].join("\n");
}

export function buildSandboxArgv({ command, args, work, rw = [], engineDir, network = true }) {
  const params = [["WORK", work], ...rw.map((p, i) => [`RW${i}`, p]), ["ENGINE_DIR", engineDir]].flatMap(([k, v]) => ["-D", `${k}=${v}`]);
  return { cmd: SANDBOX_EXEC, args: [...params, "-p", sandboxProfile({ network, rwCount: rw.length }), command, ...args] };
}

const available = (platform) => (platform === "darwin" ? access(SANDBOX_EXEC, constants.X_OK).then(() => true, () => false) : Promise.resolve(false));

/** Wrap a command in an OS sandbox when configured and supported (macOS only for now). */
export async function wrapWithSandbox({ command, args, workdir, rw = [], network = true, config, platform = process.platform }) {
  const plain = { cmd: command, args, sandboxed: false };
  if (config.sandbox === "off") return plain;
  if (!(await available(platform))) {
    if (config.sandbox === "on") throw new ToolMasterError("CONFIG_INVALID", "TOOLMASTER_SANDBOX=on but no OS sandbox is available on this platform");
    return plain;
  }
  const [work, commandReal, ...rwReal] = await Promise.all([realpath(workdir), realpath(command), ...rw.map((p) => realpath(p))]);
  return { ...buildSandboxArgv({ command, args, work, rw: rwReal, engineDir: path.dirname(commandReal), network }), sandboxed: true };
}

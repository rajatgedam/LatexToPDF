import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { ToolMasterError } from "./errors.mjs";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

const indexed = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

/** Parent folders of the given paths (not the paths themselves, not "/"). Node walks them with lstat when it resolves a script path. */
export function ancestorsOf(paths) {
  const out = new Set();
  for (const p of paths) for (let dir = path.dirname(p); dir !== path.dirname(dir); dir = path.dirname(dir)) out.add(dir);
  return [...out].sort();
}

/** macOS Seatbelt profile: later rules win, so deny broadly then re-allow the work/rw/ro/engine dirs. Only fixed names are interpolated. */
export function sandboxProfile({ network = true, rwCount = 0, roCount = 0, ancCount = 0 } = {}) {
  const sub = (names) => names.map((p) => ` (subpath (param "${p}"))`).join("");
  const rw = sub(indexed("RW", rwCount));
  const ro = sub(indexed("RO", roCount));
  const anc = indexed("ANC", ancCount).map((p) => ` (literal (param "${p}"))`).join("");
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (subpath (param "WORK"))${rw} (literal "/dev/null") (literal "/dev/dtracehelper"))`,
    '(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/private/var/root"))',
    `(allow file-read* (subpath (param "WORK"))${rw}${ro} (subpath (param "ENGINE_DIR")))`,
    ...(ancCount ? [`(allow file-read-metadata${anc})`] : []),
    ...(network ? [] : ["(deny network*)"]),
  ].join("\n");
}

export function buildSandboxArgv({ command, args, work, rw = [], ro = [], engineDir, network = true }) {
  const anc = ancestorsOf([...ro, engineDir]);
  const params = [["WORK", work], ...rw.map((p, i) => [`RW${i}`, p]), ...ro.map((p, i) => [`RO${i}`, p]), ...anc.map((p, i) => [`ANC${i}`, p]), ["ENGINE_DIR", engineDir]].flatMap(([k, v]) => ["-D", `${k}=${v}`]);
  return { cmd: SANDBOX_EXEC, args: [...params, "-p", sandboxProfile({ network, rwCount: rw.length, roCount: ro.length, ancCount: ro.length ? anc.length : 0 }), command, ...args] };
}

const available = (platform) => (platform === "darwin" ? access(SANDBOX_EXEC, constants.X_OK).then(() => true, () => false) : Promise.resolve(false));

/** Wrap a command in an OS sandbox when configured and supported (macOS only for now). */
export async function wrapWithSandbox({ command, args, workdir, rw = [], ro = [], network = true, config, platform = process.platform }) {
  const plain = { cmd: command, args, sandboxed: false };
  if (config.sandbox === "off") return plain;
  if (!(await available(platform))) {
    if (config.sandbox === "on") throw new ToolMasterError("CONFIG_INVALID", "TOOLMASTER_SANDBOX=on but no OS sandbox is available on this platform");
    return plain;
  }
  const [work, commandReal, ...real] = await Promise.all([realpath(workdir), realpath(command), ...rw.map((p) => realpath(p)), ...ro.map((p) => realpath(p))]);
  const rwReal = real.slice(0, rw.length);
  const roReal = real.slice(rw.length);
  return { ...buildSandboxArgv({ command, args, work, rw: rwReal, ro: roReal, engineDir: path.dirname(commandReal), network }), sandboxed: true };
}

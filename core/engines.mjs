import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { ToolMasterError } from "./errors.mjs";
import { ensureUnpacked } from "./pack.mjs";

const IS_WIN = process.platform === "win32";
export const exeName = (binary) => (IS_WIN && !binary.endsWith(".exe") ? `${binary}.exe` : binary);
const isExecutable = (p) => access(p, IS_WIN ? constants.F_OK : constants.X_OK).then(() => true, () => false);
const packFile = (config, spec) => path.join(config.packDir, `${spec.id}.pack`);

/** Locate an engine binary: TOOLMASTER_ENGINE_<ID> override > vendor/<id>/ (unpacking vendor/<id>.pack first if shipped) > PATH. */
export async function resolveEngine(config, spec, { unpack = true } = {}) {
  const override = config.engineOverrides[spec.id];
  if (override) {
    if (await isExecutable(override)) return override;
    throw new ToolMasterError("ENGINE_NOT_FOUND", `The path set for the ${spec.id} engine is not an executable file`);
  }
  if (unpack) await ensureUnpacked(packFile(config, spec), path.join(config.vendorDir, spec.id));
  const exe = exeName(spec.binary);
  const candidates = [
    path.join(config.vendorDir, spec.id, exe),
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((d) => path.join(d, exe)),
  ];
  for (const c of candidates) if (await isExecutable(c)) return c;
  throw new ToolMasterError("ENGINE_NOT_FOUND", `The ${spec.id} engine is not installed. Run: toolmaster install`);
}

/** Report whether an engine is usable, with its version line. A shipped but not yet unpacked engine counts as found (it unpacks on first use). */
export async function engineInfo(config, spec) {
  const enginePath = await resolveEngine(config, spec, { unpack: false }).catch(() => null);
  if (!enginePath) {
    const packed = await access(packFile(config, spec)).then(() => true, () => false);
    return packed ? { id: spec.id, found: true, version: "bundled (unpacks on first use)" } : { id: spec.id, found: false };
  }
  const version = await new Promise((resolve) => {
    execFile(enginePath, spec.versionArgs, { timeout: 10_000, env: { PATH: "/usr/bin:/bin" } }, (err, stdout) => resolve(err ? null : (stdout.split("\n")[0] ?? "").trim()));
  });
  return version ? { id: spec.id, found: true, version, path: enginePath } : { id: spec.id, found: false };
}

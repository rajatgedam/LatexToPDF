import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { ToolMasterError } from "./errors.mjs";

const IS_WIN = process.platform === "win32";
export const exeName = (binary) => (IS_WIN && !binary.endsWith(".exe") ? `${binary}.exe` : binary);
const isExecutable = (p) => access(p, IS_WIN ? constants.F_OK : constants.X_OK).then(() => true, () => false);

/** Locate an engine binary: TOOLMASTER_ENGINE_<ID> override > vendor/<id>/ > PATH. */
export async function resolveEngine(config, spec) {
  const override = config.engineOverrides[spec.id];
  if (override) {
    if (await isExecutable(override)) return override;
    throw new ToolMasterError("ENGINE_NOT_FOUND", `The path set for the ${spec.id} engine is not an executable file`);
  }
  const exe = exeName(spec.binary);
  const candidates = [
    path.join(config.vendorDir, spec.id, exe),
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((d) => path.join(d, exe)),
  ];
  for (const c of candidates) if (await isExecutable(c)) return c;
  throw new ToolMasterError("ENGINE_NOT_FOUND", `The ${spec.id} engine is not installed. Run: toolmaster install`);
}

/** Report whether an engine is usable, with its version line. */
export async function engineInfo(config, spec) {
  const enginePath = await resolveEngine(config, spec).catch(() => null);
  if (!enginePath) return { id: spec.id, found: false };
  const version = await new Promise((resolve) => {
    execFile(enginePath, spec.versionArgs, { timeout: 10_000, env: { PATH: "/usr/bin:/bin" } }, (err, stdout) => resolve(err ? null : (stdout.split("\n")[0] ?? "").trim()));
  });
  return version ? { id: spec.id, found: true, version, path: enginePath } : { id: spec.id, found: false };
}

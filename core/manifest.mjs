import { ToolMasterError } from "./errors.mjs";

const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const EXT = /^\.[a-z0-9]{1,8}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const PREVIEWS = ["file", "html", "text", "none"];
const STRING_MAX = 1000;

/** Throws TOOL_INVALID with a precise message unless the engine spec is well formed. */
export function validateEngineSpec(spec, owner = "engine") {
  const bad = (msg) => {
    throw new ToolMasterError("TOOL_INVALID", `Invalid ${owner} spec: ${msg}`);
  };
  if (!spec || typeof spec !== "object") bad("must be an object");
  if (!ID.test(spec.id ?? "")) bad("id must be kebab-case");
  if (typeof spec.binary !== "string" || !/^[A-Za-z0-9._-]+$/.test(spec.binary)) bad("binary must be a bare file name");
  if (!Array.isArray(spec.versionArgs) || !spec.versionArgs.every((a) => typeof a === "string")) bad("versionArgs must be a string array");
  if (!spec.assets || typeof spec.assets !== "object" || Object.keys(spec.assets).length === 0) bad("assets are required");
  for (const [target, asset] of Object.entries(spec.assets)) {
    if (!/^(darwin|linux|win32)-(arm64|x64)$/.test(target)) bad(`unknown platform key "${target}"`);
    if (typeof asset.url !== "string" || !asset.url.startsWith("https://")) bad(`${target}: url must be https`);
    if (!SHA256.test(asset.sha256 ?? "")) bad(`${target}: sha256 must be 64 hex characters`);
  }
  return spec;
}

/** Validates a tool manifest (the declarative half of a tool) and returns it. */
export function validateManifest(m) {
  const bad = (msg) => {
    throw new ToolMasterError("TOOL_INVALID", `Invalid tool manifest${m?.id ? ` "${m.id}"` : ""}: ${msg}`);
  };
  if (!m || typeof m !== "object") bad("manifest must be an object");
  if (!ID.test(m.id ?? "") || m.id.length > 40) bad("id must be kebab-case, at most 40 characters");
  for (const key of ["name", "description", "category"]) if (typeof m[key] !== "string" || m[key].trim() === "") bad(`${key} is required`);
  if (typeof m.icon !== "string" || m.icon.length === 0 || m.icon.length > 8) bad("icon must be a short string (an emoji)");

  const input = m.input;
  if (!input || !["text", "binary"].includes(input.kind)) bad('input.kind must be "text" or "binary"');
  if (!Array.isArray(input.accept) || input.accept.length === 0 || !input.accept.every((e) => EXT.test(e))) bad("input.accept must list extensions like .tex");
  if (input.maxBytes !== undefined && !(Number.isInteger(input.maxBytes) && input.maxBytes > 0)) bad("input.maxBytes must be a positive integer");

  const output = m.output;
  if (!output || typeof output.contentType !== "string" || !output.contentType.includes("/")) bad("output.contentType is required");
  if (!/^[a-z0-9]{1,8}$/.test(output.extension ?? "")) bad("output.extension must be lowercase letters/digits without a dot");

  if (!PREVIEWS.includes(m.preview)) bad(`preview must be one of ${PREVIEWS.join(", ")}`);

  const options = m.options ?? [];
  if (!Array.isArray(options)) bad("options must be an array");
  const seen = new Set();
  for (const o of options) {
    if (!ID.test(o?.id ?? "") || seen.has(o.id)) bad("option ids must be unique kebab-case");
    seen.add(o.id);
    if (typeof o.label !== "string") bad(`option ${o.id}: label is required`);
    if (o.type === "enum") {
      if (!Array.isArray(o.values) || o.values.length === 0 || !o.values.includes(o.default)) bad(`option ${o.id}: enum needs values including its default`);
    } else if (o.type === "boolean") {
      if (typeof o.default !== "boolean") bad(`option ${o.id}: boolean default required`);
    } else if (o.type === "string") {
      const max = o.maxLength ?? 200;
      if (!Number.isInteger(max) || max < 1 || max > STRING_MAX) bad(`option ${o.id}: maxLength must be 1-${STRING_MAX}`);
      if (typeof o.default !== "string" || o.default.length > max) bad(`option ${o.id}: string default must be at most ${max} characters`);
    } else bad(`option ${o.id}: type must be enum, boolean or string`);
  }

  const engineIds = new Set();
  for (const e of m.engines ?? []) {
    // A string names an engine in the shared catalog (engines/<id>.mjs); an object is an inline spec.
    if (typeof e === "string") {
      if (!ID.test(e)) bad(`engine id "${e}" must be kebab-case`);
    } else validateEngineSpec(e, `engine of "${m.id}"`);
    const id = typeof e === "string" ? e : e.id;
    if (engineIds.has(id)) bad(`duplicate engine ${id}`);
    engineIds.add(id);
  }
  if (typeof m.ui?.action !== "string") bad("ui.action (button label) is required");
  if (m.sample !== undefined && typeof m.sample !== "string") bad("sample must be a string");
  if (m.useWhen !== undefined && (typeof m.useWhen !== "string" || m.useWhen.length > 300)) bad("useWhen must be a string of at most 300 characters");
  return m;
}

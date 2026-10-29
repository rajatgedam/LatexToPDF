import { ToolMasterError } from "../errors.mjs";

const tooLarge = (max) => new ToolMasterError("INPUT_TOO_LARGE", `Request body exceeds ${max} bytes`);

/** Read a request body, enforcing the cap on the declared length and while streaming. */
export async function readBody(req, maxBytes) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw tooLarge(maxBytes);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

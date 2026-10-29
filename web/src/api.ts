import type { OptionValues, RunResult, ToolInfo } from "./types";

export class ApiError extends Error {
  readonly code: string;
  readonly log?: string;
  readonly status: number;

  constructor(code: string, message: string, log?: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.log = log;
    this.status = status;
  }
}

const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === "AbortError";

async function send(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError("NETWORK", "Can't reach the local server. Is ToolMaster still running?");
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const err = payload?.error;
    throw new ApiError(err?.code ?? `HTTP_${res.status}`, err?.message ?? `The server answered with status ${res.status}.`, err?.log, res.status);
  }
  return res;
}

function request(tool: ToolInfo, action: "run" | "preview", input: string | File, options: OptionValues, signal?: AbortSignal): Promise<Response> {
  const base = `/api/tools/${tool.id}/${action}`;
  if (tool.input.kind === "binary") {
    const query = new URLSearchParams(Object.entries(options).map(([k, v]) => [k, String(v)])).toString();
    return send(query ? `${base}?${query}` : base, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: input, signal });
  }
  return send(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input, options }), signal });
}

function parseMeta(raw: string | null): Record<string, unknown> {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function listTools(signal?: AbortSignal): Promise<ToolInfo[]> {
  const res = await send("/api/tools", { signal });
  return ((await res.json()) as { tools: ToolInfo[] }).tools;
}

export async function runTool(tool: ToolInfo, input: string | File, options: OptionValues, signal?: AbortSignal): Promise<RunResult> {
  const res = await request(tool, "run", input, options, signal);
  return {
    blob: await res.blob(),
    meta: parseMeta(res.headers.get("x-toolmaster-meta")),
    durationMs: Number(res.headers.get("x-toolmaster-duration-ms")) || 0,
  };
}

export async function previewTool(tool: ToolInfo, input: string | File, options: OptionValues, signal?: AbortSignal): Promise<Blob> {
  return (await request(tool, "preview", input, options, signal)).blob();
}

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

export interface CompileResult {
  blob: Blob;
  pages: number;
  durationMs: number;
}

export interface EngineHealth {
  found: boolean;
  version?: string;
  unreachable?: boolean;
}

const isAbort = (e: unknown) => (e as { name?: string } | null)?.name === "AbortError";

export async function compilePdf(source: string, signal?: AbortSignal): Promise<CompileResult> {
  let res: Response;
  try {
    res = await fetch("/api/compile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source }),
      signal,
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError("NETWORK", "Can't reach the local server. Is LatexToPDF still running?");
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const err = payload?.error;
    throw new ApiError(err?.code ?? `HTTP_${res.status}`, err?.message ?? `The server answered with status ${res.status}.`, err?.log, res.status);
  }
  return {
    blob: await res.blob(),
    pages: Number(res.headers.get("x-latex2pdf-pages")) || 0,
    durationMs: Number(res.headers.get("x-latex2pdf-duration-ms")) || 0,
  };
}

export async function fetchHealth(signal?: AbortSignal): Promise<EngineHealth> {
  try {
    const res = await fetch("/api/health", { signal });
    const json = await res.json();
    return { found: Boolean(json?.engine?.found), version: json?.engine?.version };
  } catch {
    return { found: false, unreachable: true };
  }
}

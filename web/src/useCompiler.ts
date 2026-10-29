import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, compilePdf } from "./api";

export interface PreviewData {
  url: string;
  pages: number;
  durationMs: number;
}

export interface CompileError {
  code: string;
  message: string;
  log?: string;
}

export type CompilerState =
  | { status: "idle" }
  | { status: "compiling"; previous?: PreviewData }
  | ({ status: "success"; runId: number } & PreviewData)
  | { status: "error"; error: CompileError };

/** Owns the compile lifecycle: cancels stale requests and manages blob URLs. */
export function useCompiler() {
  const [state, setState] = useState<CompilerState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const runRef = useRef(0);
  const previewRef = useRef<PreviewData | undefined>(undefined);

  const dropUrl = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    previewRef.current = undefined;
  }, []);

  const compile = useCallback(
    async (source: string) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setState({ status: "compiling", previous: previewRef.current });
      try {
        const { blob, pages, durationMs } = await compilePdf(source, ac.signal);
        if (ac.signal.aborted) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        previewRef.current = { url, pages, durationMs };
        runRef.current += 1;
        setState({ status: "success", runId: runRef.current, url, pages, durationMs });
      } catch (e) {
        if (ac.signal.aborted) return;
        dropUrl();
        const err = e instanceof ApiError ? e : new ApiError("UNKNOWN", "Something unexpected happened.");
        setState({ status: "error", error: { code: err.code, message: err.message, log: err.log } });
      }
    },
    [dropUrl],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    dropUrl();
    setState({ status: "idle" });
  }, [dropUrl]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  return { state, compile, reset };
}

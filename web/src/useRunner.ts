import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, previewTool, runTool } from "./api";
import type { OptionValues, ToolInfo } from "./types";

export interface Outcome {
  url: string;
  previewUrl?: string;
  /** Result text for tools with a "text" preview (shown in the page and copyable). */
  text?: string;
  meta: Record<string, unknown>;
  durationMs: number;
  size: number;
}

/** Long documents stay downloadable in full but only this much is drawn, so the page stays quick. */
export const TEXT_PREVIEW_CHARS = 200_000;

export interface RunError {
  code: string;
  message: string;
  log?: string;
}

export type RunnerState =
  | { status: "idle" }
  | { status: "working"; previous?: Outcome }
  | ({ status: "success"; runId: number } & Outcome)
  | { status: "error"; error: RunError };

/** Owns one run lifecycle: cancels stale requests and manages the blob URLs for the result and its preview. */
export function useRunner() {
  const [state, setState] = useState<RunnerState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const currentRef = useRef<Outcome | undefined>(undefined);
  const runRef = useRef(0);

  const release = useCallback(() => {
    const cur = currentRef.current;
    if (cur) {
      URL.revokeObjectURL(cur.url);
      if (cur.previewUrl) URL.revokeObjectURL(cur.previewUrl);
    }
    currentRef.current = undefined;
  }, []);

  const run = useCallback(
    async (tool: ToolInfo, input: string | File, options: OptionValues) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setState({ status: "working", previous: currentRef.current });
      try {
        const [result, preview] = await Promise.all([
          runTool(tool, input, options, ac.signal),
          tool.preview === "html" ? previewTool(tool, input, options, ac.signal).catch(() => null) : Promise.resolve(null),
        ]);
        if (ac.signal.aborted) return;
        const text = tool.preview === "text" ? await result.blob.text() : undefined;
        if (ac.signal.aborted) return;
        release();
        const outcome: Outcome = {
          url: URL.createObjectURL(result.blob),
          previewUrl: preview ? URL.createObjectURL(preview) : undefined,
          text,
          meta: result.meta,
          durationMs: result.durationMs,
          size: result.blob.size,
        };
        currentRef.current = outcome;
        runRef.current += 1;
        setState({ status: "success", runId: runRef.current, ...outcome });
      } catch (e) {
        if (ac.signal.aborted) return;
        release();
        const err = e instanceof ApiError ? e : new ApiError("UNKNOWN", "Something unexpected happened.");
        setState({ status: "error", error: { code: err.code, message: err.message, log: err.log } });
      }
    },
    [release],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    release();
    setState({ status: "idle" });
  }, [release]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      release();
    },
    [release],
  );

  return { state, run, reset };
}

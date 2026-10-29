import { formatBytes } from "../files";
import type { RunnerState } from "../useRunner";
import type { ToolInfo } from "../types";

export function statusText(state: RunnerState, _tool?: ToolInfo): string {
  switch (state.status) {
    case "idle":
      return "Ready when you are";
    case "working":
      return "Working on it... hold my coffee";
    case "success": {
      const pages = typeof state.meta.pages === "number" ? state.meta.pages : 0;
      const what = pages > 0 ? `${pages} page${pages === 1 ? "" : "s"}` : formatBytes(state.size);
      return `Ta-da! ${what} · ${(state.durationMs / 1000).toFixed(1)}s`;
    }
    case "error":
      return "Hmm, that didn't work";
  }
}

export function StatusPill({ state, tool }: { state: RunnerState; tool?: ToolInfo }) {
  return (
    <p className={`pill pill--${state.status}`} role="status" aria-live="polite">
      <span className="pill__dot" aria-hidden="true" />
      {statusText(state, tool)}
    </p>
  );
}

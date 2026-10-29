import type { CompilerState } from "../useCompiler";

export function statusText(state: CompilerState): string {
  switch (state.status) {
    case "idle":
      return "Ready when you are";
    case "compiling":
      return "Typesetting... hold my coffee";
    case "success":
      return `Ta-da! ${state.pages} page${state.pages === 1 ? "" : "s"} · ${(state.durationMs / 1000).toFixed(1)}s`;
    case "error":
      return "Hmm, LaTeX is grumpy";
  }
}

export function StatusPill({ state }: { state: CompilerState }) {
  return (
    <p className={`pill pill--${state.status}`} role="status" aria-live="polite">
      <span className="pill__dot" aria-hidden="true" />
      {statusText(state)}
    </p>
  );
}

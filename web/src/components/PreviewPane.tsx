import type { CompilerState } from "../useCompiler";
import { Confetti } from "./Confetti";
import { ErrorLog } from "./ErrorLog";
import { Mascot, type Mood } from "./Mascot";
import { StatusPill } from "./StatusPill";

interface Props {
  state: CompilerState;
  downloadName: string;
}

export function PreviewPane({ state, downloadName }: Props) {
  const url = state.status === "success" ? state.url : state.status === "compiling" ? state.previous?.url : undefined;
  const mood: Mood = state.status === "compiling" ? "working" : state.status === "error" ? "oops" : state.status === "success" ? "happy" : "idle";

  return (
    <section className="pane pane--preview" aria-label="PDF preview">
      <div className="toolbar">
        <StatusPill state={state} />
        <a
          className="btn btn--teal"
          href={url}
          download={downloadName}
          aria-disabled={!url}
          onClick={(e) => {
            if (!url) e.preventDefault();
          }}
        >
          Download PDF
        </a>
      </div>
      <div className={`stage stage--${state.status}`}>
        {state.status === "error" ? <ErrorLog error={state.error} /> : null}
        {url ? <iframe className="stage__frame" title="PDF preview" src={url} /> : null}
        {!url && state.status !== "error" ? (
          <div className="empty">
            <Mascot mood={mood} />
            <p className="empty__title">{state.status === "compiling" ? "Typesetting..." : "Your PDF shows up here"}</p>
            <p className="empty__hint">Paste LaTeX on the left, then press Compile (or Ctrl/Cmd + Enter).</p>
          </div>
        ) : null}
        {state.status === "compiling" && url ? (
          <div className="stage__busy" aria-hidden="true">
            <Mascot mood="working" />
          </div>
        ) : null}
        {state.status === "error" ? <Mascot mood="oops" /> : null}
        {state.status === "success" ? <Confetti burstKey={state.runId} /> : null}
      </div>
    </section>
  );
}

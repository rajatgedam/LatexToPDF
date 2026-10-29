import { useState } from "react";
import { formatBytes } from "../files";
import { TEXT_PREVIEW_CHARS, type RunnerState } from "../useRunner";
import type { ToolInfo } from "../types";
import { Confetti } from "./Confetti";
import { ErrorLog } from "./ErrorLog";
import { Mascot, type Mood } from "./Mascot";
import { StatusPill } from "./StatusPill";

interface Props {
  tool: ToolInfo;
  state: RunnerState;
  downloadName: string;
}

export function ResultPane({ tool, state, downloadName }: Props) {
  const [copied, setCopied] = useState(false);
  const outcome = state.status === "success" ? state : state.status === "working" ? state.previous : undefined;
  const frameUrl = tool.preview === "file" ? outcome?.url : tool.preview === "html" ? outcome?.previewUrl : undefined;
  const text = tool.preview === "text" ? outcome?.text : undefined;
  const mood: Mood = state.status === "working" ? "working" : state.status === "error" ? "oops" : state.status === "success" ? "happy" : "idle";
  const ext = tool.output.extension.toUpperCase();

  async function copy() {
    if (text === undefined) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="pane pane--preview" aria-label="Result preview">
      <div className="toolbar">
        <StatusPill state={state} tool={tool} />
        {text !== undefined ? (
          <button type="button" className="btn btn--ghost" onClick={() => void copy()}>
            {copied ? "Copied!" : "Copy"}
          </button>
        ) : null}
        <a
          className="btn btn--teal"
          href={outcome?.url}
          download={downloadName}
          aria-disabled={!outcome}
          onClick={(e) => {
            if (!outcome) e.preventDefault();
          }}
        >
          Download {ext}
        </a>
      </div>
      <div className={`stage stage--${state.status}`}>
        {state.status === "error" ? <ErrorLog error={state.error} /> : null}
        {frameUrl ? <iframe className="stage__frame" title="Result preview" src={frameUrl} {...(tool.preview === "html" ? { sandbox: "" } : {})} /> : null}
        {text !== undefined ? (
          <pre className="stage__text" tabIndex={0} aria-label="Result text">
            {text.length > TEXT_PREVIEW_CHARS ? `${text.slice(0, TEXT_PREVIEW_CHARS)}\n\n[Showing the first ${TEXT_PREVIEW_CHARS.toLocaleString()} characters. Download the file for everything.]` : text}
          </pre>
        ) : null}
        {outcome && !frameUrl && text === undefined ? (
          <div className="empty">
            <Mascot mood={mood} />
            <p className="empty__title">Your {ext} file is ready</p>
            <p className="empty__hint">
              {downloadName} · {formatBytes(outcome.size)}. Press Download to save it.
            </p>
          </div>
        ) : null}
        {!outcome && state.status !== "error" ? (
          <div className="empty">
            <Mascot mood={mood} />
            <p className="empty__title">{state.status === "working" ? "Working..." : "Your result shows up here"}</p>
            <p className="empty__hint">
              Add your input on the left, then press {tool.ui.action} (or Ctrl/Cmd + Enter).
            </p>
          </div>
        ) : null}
        {state.status === "working" && outcome ? (
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

import { useRef, useState, type DragEvent } from "react";
import { DEFAULT_MAX_BYTES, formatBytes, validateFile } from "../files";
import type { ToolInfo } from "../types";

interface Props {
  tool: ToolInfo;
  file: File | null;
  onFile: (file: File | null) => void;
  notice: string | null;
  onNotice: (message: string | null) => void;
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/** Input pane for tools whose input.kind is "binary": pick or drop one file. */
export function FilePane({ tool, file, onFile, notice, onNotice }: Props) {
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const accept = tool.input.accept;

  function take(f: File | undefined) {
    if (!f) return;
    const problem = validateFile(f, accept, tool.input.maxBytes ?? DEFAULT_MAX_BYTES);
    if (problem) return onNotice(problem);
    onNotice(null);
    onFile(f);
  }

  return (
    <section className="pane pane--editor" aria-label="Editor">
      {notice ? (
        <p className="notice" role="alert">
          {notice}
        </p>
      ) : null}
      <div
        className={`filedrop${dragging ? " dropzone--active" : ""}`}
        data-testid="dropzone"
        role="group"
        aria-label="File drop zone"
        onDragEnter={(e) => hasFiles(e) && setDragging(true)}
        onDragOver={(e) => hasFiles(e) && e.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files[0]);
        }}
      >
        <span className="dropzone__doodle" aria-hidden="true">
          {tool.icon}
        </span>
        {file ? (
          <p className="filedrop__name">
            {file.name} <span className="filedrop__size">({formatBytes(file.size)})</span>
          </p>
        ) : (
          <p className="filedrop__name">Drop a {accept.join(" / ")} file here</p>
        )}
        <div className="filedrop__actions">
          <button type="button" className="btn btn--ghost" onClick={() => picker.current?.click()}>
            Open file
          </button>
          {file ? (
            <button type="button" className="btn btn--ghost" onClick={() => onFile(null)}>
              Clear
            </button>
          ) : null}
        </div>
        <input ref={picker} className="sr-only" type="file" accept={accept.join(",")} aria-label={`Open a ${accept.join(" or ")} file`} tabIndex={-1} onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    </section>
  );
}

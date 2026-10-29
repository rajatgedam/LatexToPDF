import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ACCEPT, readFileText, validateFile } from "../files";

interface Props {
  source: string;
  onChange: (value: string) => void;
  onFile: (text: string, name: string) => void;
  onCompile: () => void;
  onSample: () => void;
  onClear: () => void;
  notice: string | null;
  onNotice: (message: string | null) => void;
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
const MAX_GUTTER_LINES = 20_000;

export function EditorPane({ source, onChange, onFile, onCompile, onSample, onClear, notice, onNotice }: Props) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLPreElement>(null);
  const cursor = useRef<number | null>(null);
  const trapTab = useRef(true);
  const picker = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (cursor.current !== null && area.current) {
      area.current.setSelectionRange(cursor.current, cursor.current);
      cursor.current = null;
    }
  });

  const lineCount = Math.min(source.split("\n").length, MAX_GUTTER_LINES);
  const numbers = Array.from({ length: lineCount }, (_, i) => i + 1).join("\n");

  async function takeFile(file: File | undefined) {
    if (!file) return;
    const problem = validateFile(file);
    if (problem) return onNotice(problem);
    try {
      onFile(await readFileText(file), file.name);
      onNotice(null);
    } catch {
      onNotice("Couldn't read that file.");
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      return onCompile();
    }
    if (e.key === "Escape") trapTab.current = false;
    else if (e.key !== "Tab") trapTab.current = true;
    if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && trapTab.current) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: end, value } = el;
      cursor.current = s + 2;
      onChange(`${value.slice(0, s)}  ${value.slice(end)}`);
    }
  }

  return (
    <section className="pane pane--editor" aria-label="LaTeX editor">
      <div className="toolbar">
        <button type="button" className="btn btn--ghost" onClick={() => picker.current?.click()}>
          Open file
        </button>
        <input ref={picker} className="sr-only" type="file" accept={ACCEPT} aria-label="Open a .tex or .txt file" tabIndex={-1} onChange={(e) => { void takeFile(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" className="btn btn--ghost" onClick={onSample}>
          Load sample
        </button>
        <button type="button" className="btn btn--ghost" onClick={onClear}>
          Clear
        </button>
      </div>
      {notice ? (
        <p className="notice" role="alert">
          {notice}
        </p>
      ) : null}
      <div
        className={`dropzone${dragging ? " dropzone--active" : ""}`}
        data-testid="dropzone"
        role="group"
        aria-label="LaTeX editor and file drop zone"
        onDragEnter={(e) => {
          if (!hasFiles(e)) return;
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => hasFiles(e) && e.preventDefault()}
        onDragLeave={(e) => {
          if (!hasFiles(e)) return;
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          void takeFile(e.dataTransfer.files[0]);
        }}
      >
        <pre className="gutter" ref={gutter} aria-hidden="true">
          {numbers}
        </pre>
        <textarea
          ref={area}
          className="editor"
          aria-label="LaTeX source"
          placeholder={"Paste LaTeX here, or drop a .tex / .txt file anywhere on this side.\n\n\\documentclass{article}\n\\begin{document}\nHello!\n\\end{document}"}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={source}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
        />
        {dragging ? (
          <div className="dropzone__overlay" aria-hidden="true">
            <span className="dropzone__doodle">📄</span>
            <p>Drop it like it's hot</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

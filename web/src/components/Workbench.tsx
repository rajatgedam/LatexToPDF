import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_MAX_BYTES, formatBytes, outputNameFor } from "../files";
import type { OptionValues, ToolInfo } from "../types";
import { useRunner } from "../useRunner";
import { EditorPane } from "./EditorPane";
import { FilePane } from "./FilePane";
import { OptionsBar, defaultOptions } from "./OptionsBar";
import { ResultPane } from "./ResultPane";

const AUTO_DELAY_MS = 900;

function EngineLine({ tool }: { tool: ToolInfo }) {
  if (tool.status.engines.length === 0) return <span>Runs entirely in ToolMaster</span>;
  if (!tool.status.ready) return <span className="footer__warn">Engine missing. Run: toolmaster install {tool.id}</span>;
  return <span>Engine: {tool.status.engines.map((e) => e.version ?? e.id).join(", ")}</span>;
}

/** The one screen every tool shares: input on the left, result on the right, options and the action in the bar. */
export function Workbench({ tool }: { tool: ToolInfo }) {
  const isText = tool.input.kind === "text";
  const maxBytes = tool.input.maxBytes ?? DEFAULT_MAX_BYTES;
  const [source, setSource] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [options, setOptions] = useState<OptionValues>(() => defaultOptions(tool.options));
  const [auto, setAuto] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { state, run, reset } = useRunner();

  const bytes = useMemo(() => (isText ? new TextEncoder().encode(source).length : (file?.size ?? 0)), [isText, source, file]);
  const canRun = isText ? source.trim() !== "" && bytes <= maxBytes : file !== null;
  const go = useCallback(() => void run(tool, isText ? source : (file as File), options), [run, tool, isText, source, file, options]);

  useEffect(() => {
    if (!isText || !auto || !canRun) return;
    const t = setTimeout(go, AUTO_DELAY_MS);
    return () => clearTimeout(t);
  }, [isText, auto, canRun, go]);

  const clear = () => {
    setSource("");
    setFile(null);
    setFileName(null);
    setNotice(null);
    reset();
  };

  return (
    <div className="tool">
      <div className="workbar">
        <a className="back" href="#/">
          ← All tools
        </a>
        <h2 className="workbar__title">
          <span aria-hidden="true">{tool.icon}</span> {tool.name}
        </h2>
        <div className="header__actions">
          <OptionsBar options={tool.options ?? []} values={options} onChange={setOptions} />
          {isText ? (
            <label className="switch">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              <span className="switch__track" aria-hidden="true" />
              <span>Auto-run</span>
            </label>
          ) : null}
          <button type="button" className="btn btn--primary" onClick={go} disabled={!canRun}>
            {tool.ui.action} <kbd>⌘↵</kbd>
          </button>
        </div>
      </div>
      <main className="split">
        {isText ? (
          <EditorPane
            tool={tool}
            source={source}
            onChange={setSource}
            onFile={(text, name) => {
              setSource(text);
              setFileName(name);
            }}
            onRun={() => canRun && go()}
            onSample={() => {
              setSource(tool.sample ?? "");
              setFileName(null);
              setNotice(null);
            }}
            onClear={clear}
            notice={notice}
            onNotice={setNotice}
          />
        ) : (
          <FilePane
            tool={tool}
            file={file}
            onFile={(f) => {
              setFile(f);
              setFileName(f?.name ?? null);
              if (!f) reset();
            }}
            notice={notice}
            onNotice={setNotice}
          />
        )}
        <ResultPane tool={tool} state={state} downloadName={outputNameFor(fileName, tool.output.extension)} />
      </main>
      <div className="statusbar">
        <span className={bytes > maxBytes ? "footer__warn" : undefined}>
          {isText ? `${source.length.toLocaleString()} chars` : file ? formatBytes(bytes) : "No file yet"}
          {bytes > maxBytes ? ` · over the ${formatBytes(maxBytes)} limit, trim it a bit` : ""}
        </span>
        <EngineLine tool={tool} />
      </div>
    </div>
  );
}

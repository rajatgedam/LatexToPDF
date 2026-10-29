import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchHealth, type EngineHealth } from "./api";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { EditorPane } from "./components/EditorPane";
import { PreviewPane } from "./components/PreviewPane";
import { MAX_BYTES, pdfNameFor } from "./files";
import { SAMPLE } from "./sample";
import { useCompiler } from "./useCompiler";

const AUTO_DELAY_MS = 900;

export default function App() {
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const { state, compile, reset } = useCompiler();

  const bytes = useMemo(() => new TextEncoder().encode(source).length, [source]);
  const canCompile = source.trim() !== "" && bytes <= MAX_BYTES;
  const run = useCallback(() => void compile(source), [compile, source]);

  useEffect(() => {
    const ac = new AbortController();
    void fetchHealth(ac.signal).then((h) => !ac.signal.aborted && setHealth(h));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!auto || !canCompile) return;
    const t = setTimeout(run, AUTO_DELAY_MS);
    return () => clearTimeout(t);
  }, [auto, canCompile, run]);

  // Stop the browser from navigating away when a file is dropped outside the editor.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  return (
    <div className="app">
      <Header auto={auto} onAuto={setAuto} onCompile={run} canCompile={canCompile} />
      <main className="split">
        <EditorPane
          source={source}
          onChange={setSource}
          onFile={(text, name) => {
            setSource(text);
            setFileName(name);
          }}
          onCompile={() => canCompile && run()}
          onSample={() => {
            setSource(SAMPLE);
            setFileName(null);
            setNotice(null);
          }}
          onClear={() => {
            setSource("");
            setFileName(null);
            setNotice(null);
            reset();
          }}
          notice={notice}
          onNotice={setNotice}
        />
        <PreviewPane state={state} downloadName={pdfNameFor(fileName)} />
      </main>
      <Footer chars={source.length} bytes={bytes} health={health} />
    </div>
  );
}

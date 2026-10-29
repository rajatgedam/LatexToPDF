import { useCallback, useEffect, useState } from "react";
import { ApiError, listTools } from "./api";
import { Home } from "./components/Home";
import { Mascot } from "./components/Mascot";
import { Workbench } from "./components/Workbench";
import type { ToolInfo } from "./types";
import { useHashRoute } from "./useHashRoute";

type Catalog = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; tools: ToolInfo[] };

export default function App() {
  const { route, navigate } = useHashRoute();
  const [catalog, setCatalog] = useState<Catalog>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setCatalog({ state: "loading" });
    listTools(ac.signal).then(
      (tools) => !ac.signal.aborted && setCatalog({ state: "ready", tools }),
      (e) => !ac.signal.aborted && setCatalog({ state: "error", message: e instanceof ApiError ? e.message : "Something went wrong." }),
    );
    return () => ac.abort();
  }, [attempt]);

  // Stop the browser from navigating away when a file is dropped outside a drop zone.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  const open = useCallback((id: string) => navigate({ name: "tool", id }), [navigate]);
  const tool = catalog.state === "ready" && route.name === "tool" ? catalog.tools.find((t) => t.id === route.id) : undefined;

  return (
    <div className="app">
      <header className="header">
        <a className="brand" href="#/" aria-label="ToolMaster home">
          <span className="brand__logo" aria-hidden="true">
            TM
          </span>
          <div>
            <h1 className="brand__title">ToolMaster</h1>
            <span className="brand__tag">Small tools. Big relief. All local.</span>
          </div>
        </a>
      </header>

      {catalog.state === "loading" ? (
        <main className="home">
          <p className="home__empty" role="status">
            Loading your tools...
          </p>
        </main>
      ) : catalog.state === "error" ? (
        <main className="home">
          <div className="errorlog" role="alert">
            <p className="errorlog__title">The local server isn't reachable.</p>
            <p className="errorlog__message">{catalog.message} Restart ToolMaster, then try again.</p>
            <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        </main>
      ) : route.name === "home" ? (
        <Home tools={catalog.tools} onOpen={open} />
      ) : tool ? (
        <Workbench key={tool.id} tool={tool} />
      ) : (
        <main className="home">
          <div className="empty">
            <Mascot mood="oops" />
            <p className="empty__title">That tool isn't in this build</p>
            <p className="empty__hint">
              <a href="#/">Back to the menu</a>
            </p>
          </div>
        </main>
      )}

      <footer className="footer">
        <span>ToolMaster runs locally. Nothing is uploaded.</span>
        {catalog.state === "ready" ? <span>{catalog.tools.length} tool{catalog.tools.length === 1 ? "" : "s"} installed</span> : null}
      </footer>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { ToolInfo } from "../types";
import { Mascot } from "./Mascot";

interface Props {
  tools: ToolInfo[];
  onOpen: (id: string) => void;
}

export function matches(tool: ToolInfo, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [tool.id, tool.name, tool.description, tool.category, ...(tool.tags ?? [])].some((s) => s.toLowerCase().includes(q));
}

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);

/** The start menu: search, categories, and one card per tool. Keys: "/" searches, 1-9 open the Nth visible tool. */
export function Home({ tools, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const visible = useMemo(() => tools.filter((t) => matches(t, query)), [tools, query]);
  const groups = useMemo(() => {
    const map = new Map<string, ToolInfo[]>();
    for (const t of visible) map.set(t.category, [...(map.get(t.category) ?? []), t]);
    return [...map.entries()];
  }, [visible]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (/^[1-9]$/.test(e.key) && visible[Number(e.key) - 1]) {
        onOpen(visible[Number(e.key) - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onOpen]);

  let index = 0;
  return (
    <main className="home">
      <div className="home__hero">
        <Mascot mood="happy" />
        <div>
          <h2 className="home__title">What shall we make today?</h2>
          <p className="home__sub">Pick a tool. Everything runs on your machine, nothing is uploaded.</p>
        </div>
      </div>
      <div className="search">
        <input ref={search} type="search" aria-label="Search tools" placeholder="Search tools...  (press / )" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {tools.length === 0 ? (
        <p className="home__empty">No tools are installed in this build.</p>
      ) : visible.length === 0 ? (
        <p className="home__empty">Nothing matches "{query}". Try another word.</p>
      ) : (
        groups.map(([category, list]) => (
          <section key={category} className="home__group" aria-label={category}>
            <h3 className="home__category">{category}</h3>
            <ul className="cards">
              {list.map((t) => {
                const n = ++index;
                return (
                  <li key={t.id}>
                    <a className="card" href={`#/tool/${t.id}`}>
                      <span className="card__icon" aria-hidden="true">
                        {t.icon}
                      </span>
                      <span className="card__body">
                        <span className="card__name">{t.name}</span>
                        <span className="card__desc">{t.description}</span>
                        <span className="card__chips">
                          <span className="chip">
                            {t.input.accept[0]} → .{t.output.extension}
                          </span>
                          {t.status.ready ? <span className="chip chip--ok">Ready</span> : <span className="chip chip--warn">Needs setup</span>}
                        </span>
                        {!t.status.ready ? <span className="card__hint">Run: toolmaster install {t.id}</span> : null}
                      </span>
                      {n <= 9 ? (
                        <kbd className="card__key" aria-hidden="true">
                          {n}
                        </kbd>
                      ) : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}

import { useCallback, useEffect, useState } from "react";

export type Route = { name: "home" } | { name: "tool"; id: string };

export function parseHash(hash: string): Route {
  const m = /^#\/tool\/([a-z][a-z0-9-]{0,39})\/?$/.exec(hash);
  return m ? { name: "tool", id: m[1] } : { name: "home" };
}

/** Tiny hash router: `#/` is the menu, `#/tool/<id>` a tool. Works from any static host. */
export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((to: Route) => {
    window.location.hash = to.name === "home" ? "#/" : `#/tool/${to.id}`;
  }, []);
  return { route, navigate };
}

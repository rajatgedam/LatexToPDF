import type { EngineHealth } from "../api";
import { MAX_BYTES } from "../files";

interface Props {
  chars: number;
  bytes: number;
  health: EngineHealth | null;
}

function engineText(h: EngineHealth | null) {
  if (!h) return "Checking engine...";
  if (h.unreachable) return "The local server isn't reachable. Restart LatexToPDF.";
  if (!h.found) return "Engine missing. Run: npm run install:engine";
  return `Engine: ${h.version ?? "Tectonic"}`;
}

export function Footer({ chars, bytes, health }: Props) {
  const over = bytes > MAX_BYTES;
  return (
    <footer className="footer">
      <span className={over ? "footer__warn" : undefined}>
        {chars.toLocaleString()} chars{over ? " · over the 1 MiB limit, trim it a bit" : ""}
      </span>
      <span className={health && (!health.found || health.unreachable) ? "footer__warn" : undefined}>{engineText(health)}</span>
    </footer>
  );
}

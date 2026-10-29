import { useEffect, useState, type CSSProperties } from "react";

const COLORS = ["var(--coral)", "var(--teal)", "var(--sun)", "var(--lav)", "var(--sky)", "var(--berry)"];
const PARTICLES = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  return { x: Math.round(Math.cos(angle) * (70 + (i % 3) * 18)), y: Math.round(Math.sin(angle) * (70 + (i % 4) * 14)) - 20, r: (i * 47) % 360, c: COLORS[i % COLORS.length] };
});

/** One-shot CSS confetti burst; remounts per `burstKey` and removes itself afterwards. */
export function Confetti({ burstKey }: { burstKey: number }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1100);
    return () => clearTimeout(t);
  }, [burstKey]);
  if (!visible) return null;
  return (
    <div className="confetti" data-testid="confetti" aria-hidden="true" key={burstKey}>
      {PARTICLES.map((p, i) => (
        <span key={i} className="confetti__bit" style={{ "--x": `${p.x}px`, "--y": `${p.y}px`, "--r": `${p.r}deg`, "--c": p.c } as CSSProperties} />
      ))}
    </div>
  );
}

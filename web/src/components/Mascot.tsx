export type Mood = "idle" | "working" | "happy" | "oops";

/** "Texy", a pencil-holding blob. Purely decorative; animation is driven by CSS classes. */
export function Mascot({ mood }: { mood: Mood }) {
  return (
    <svg className={`mascot mascot--${mood}`} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <ellipse className="mascot__shadow" cx="60" cy="108" rx="30" ry="6" />
      <g className="mascot__body">
        <path d="M60 14c26 0 44 18 44 44 0 24-16 42-44 42S16 82 16 58c0-26 18-44 44-44z" className="mascot__skin" />
        <circle cx="46" cy="52" r="6" className="mascot__eye" />
        <circle cx="74" cy="52" r="6" className="mascot__eye" />
        <path className="mascot__mouth mascot__mouth--happy" d="M46 68q14 14 28 0" />
        <path className="mascot__mouth mascot__mouth--meh" d="M48 72h24" />
        <path className="mascot__mouth mascot__mouth--oops" d="M48 76q12-10 24 0" />
        <ellipse cx="34" cy="64" rx="6" ry="4" className="mascot__blush" />
        <ellipse cx="86" cy="64" rx="6" ry="4" className="mascot__blush" />
        <path className="mascot__sweat" d="M92 34c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12z" />
      </g>
      <g className="mascot__pencil">
        <rect x="84" y="62" width="10" height="36" rx="2" className="mascot__pencil-body" transform="rotate(25 89 80)" />
        <path d="M95 96l-6 12-5-13z" className="mascot__pencil-tip" transform="rotate(25 89 80)" />
      </g>
    </svg>
  );
}

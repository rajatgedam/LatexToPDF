interface Props {
  auto: boolean;
  onAuto: (value: boolean) => void;
  onCompile: () => void;
  canCompile: boolean;
}

export function Header({ auto, onAuto, onCompile, canCompile }: Props) {
  return (
    <header className="header">
      <div className="brand">
        <span className="brand__logo" aria-hidden="true">
          TeX
        </span>
        <div>
          <h1 className="brand__title">LaTeX → PDF</h1>
          <p className="brand__tag">Paste, drop, ta-da. Runs only on your machine.</p>
        </div>
      </div>
      <div className="header__actions">
        <label className="switch">
          <input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} />
          <span className="switch__track" aria-hidden="true" />
          <span>Auto-compile</span>
        </label>
        <button type="button" className="btn btn--primary" onClick={onCompile} disabled={!canCompile}>
          Compile <kbd>⌘↵</kbd>
        </button>
      </div>
    </header>
  );
}

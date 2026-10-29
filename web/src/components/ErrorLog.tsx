import type { RunError } from "../useRunner";

export function ErrorLog({ error }: { error: RunError }) {
  return (
    <div className="errorlog" role="alert">
      <p className="errorlog__title">Hmm, that didn't work. Here is why:</p>
      <p className="errorlog__message">{error.message}</p>
      {error.log ? (
        <details open>
          <summary>Details</summary>
          <pre className="errorlog__pre">{error.log}</pre>
        </details>
      ) : null}
    </div>
  );
}

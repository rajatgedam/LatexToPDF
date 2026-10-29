import type { CompileError } from "../useCompiler";

export function ErrorLog({ error }: { error: CompileError }) {
  return (
    <div className="errorlog" role="alert">
      <p className="errorlog__title">Hmm, LaTeX is grumpy. Here is why:</p>
      <p className="errorlog__message">{error.message}</p>
      {error.log ? (
        <details open>
          <summary>Engine log</summary>
          <pre className="errorlog__pre">{error.log}</pre>
        </details>
      ) : null}
    </div>
  );
}

export const DEFAULT_MAX_BYTES = 1_048_576;

export function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${+(n / 1_048_576).toFixed(1)} MiB`;
  if (n >= 1024) return `${+(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
}

const extOf = (name: string) => (/\.[^./\\]+$/.exec(name)?.[0] ?? "").toLowerCase();

/** Returns a friendly error message, or null if the file is fine for this tool. */
export function validateFile(file: File, accept: string[], maxBytes = DEFAULT_MAX_BYTES): string | null {
  if (!accept.includes(extOf(file.name))) return `Only ${accept.join(", ")} files, please.`;
  if (file.size > maxBytes) return `That file is over the ${formatBytes(maxBytes)} limit.`;
  return null;
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsText(file, "utf-8");
  });
}

/** Derive a safe download name (`my cv.tex` -> `my cv.docx`). */
export function outputNameFor(fileName: string | null, extension: string): string {
  const base = (fileName ?? "").split(/[\\/]/).pop() ?? "";
  const stem = base.replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N} _.()-]/gu, "").trim();
  return `${stem || "result"}.${extension}`;
}

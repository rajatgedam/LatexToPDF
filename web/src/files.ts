export const MAX_BYTES = 1_048_576;
export const ACCEPT = ".tex,.latex,.txt,text/plain";

const ALLOWED = /\.(tex|latex|txt)$/i;

/** Returns a friendly error message, or null if the file is fine. */
export function validateFile(file: File): string | null {
  if (!ALLOWED.test(file.name)) return "Only .tex, .latex or .txt files, please.";
  if (file.size > MAX_BYTES) return "That file is over the 1 MiB limit.";
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

/** Derive a safe download name (`my cv.tex` -> `my cv.pdf`). */
export function pdfNameFor(fileName: string | null): string {
  const base = (fileName ?? "").split(/[\\/]/).pop() ?? "";
  const stem = base.replace(ALLOWED, "").replace(/[^\p{L}\p{N} _.()-]/gu, "").trim();
  return `${stem || "resume"}.pdf`;
}

import { describe, expect, it } from "vitest";
import { MAX_BYTES, pdfNameFor, readFileText, validateFile } from "./files";

const file = (content: string, name: string, type = "") => new File([content], name, { type });

describe("validateFile", () => {
  it("accepts .tex, .latex and .txt up to the limit", () => {
    for (const n of ["a.tex", "b.LATEX", "c.txt"]) expect(validateFile(file("x", n))).toBeNull();
  });

  it("rejects other types with a friendly message", () => {
    expect(validateFile(file("x", "pic.png"))).toMatch(/\.tex|\.txt/);
    expect(validateFile(file("x", "noext"))).toMatch(/\.tex|\.txt/);
  });

  it("rejects files over 1 MiB", () => {
    expect(validateFile(file("x".repeat(MAX_BYTES + 1), "big.tex"))).toMatch(/1 MiB/);
    expect(validateFile(file("x".repeat(MAX_BYTES), "ok.tex"))).toBeNull();
  });
});

describe("readFileText", () => {
  it("reads UTF-8 text", async () => {
    expect(await readFileText(file("Résumé ✓", "a.tex"))).toBe("Résumé ✓");
  });
});

describe("pdfNameFor", () => {
  it("swaps the extension and sanitizes", () => {
    expect(pdfNameFor("my cv.tex")).toBe("my cv.pdf");
    expect(pdfNameFor("notes.txt")).toBe("notes.pdf");
    expect(pdfNameFor("../../evil/../x.tex")).toBe("x.pdf");
    expect(pdfNameFor('we"ird<name>.tex')).toBe("weirdname.pdf");
    expect(pdfNameFor(null)).toBe("resume.pdf");
    expect(pdfNameFor(".tex")).toBe("resume.pdf");
  });
});

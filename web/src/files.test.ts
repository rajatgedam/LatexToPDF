import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_BYTES, formatBytes, outputNameFor, readFileText, validateFile } from "./files";

const file = (content: string, name: string) => new File([content], name);
const ACCEPT = [".tex", ".latex", ".txt"];

describe("validateFile", () => {
  it("accepts listed extensions case-insensitively up to the limit", () => {
    for (const n of ["a.tex", "b.LATEX", "c.txt"]) expect(validateFile(file("x", n), ACCEPT)).toBeNull();
  });

  it("rejects other types, naming the allowed ones", () => {
    expect(validateFile(file("x", "pic.png"), ACCEPT)).toBe("Only .tex, .latex, .txt files, please.");
    expect(validateFile(file("x", "noext"), ACCEPT)).toMatch(/\.tex/);
    expect(validateFile(file("x", "archive.tar.gz"), [".gz"])).toBeNull();
  });

  it("enforces the size limit, default 1 MiB or the tool's own", () => {
    expect(validateFile(file("x".repeat(DEFAULT_MAX_BYTES + 1), "big.tex"), ACCEPT)).toBe("That file is over the 1 MiB limit.");
    expect(validateFile(file("x".repeat(DEFAULT_MAX_BYTES), "ok.tex"), ACCEPT)).toBeNull();
    expect(validateFile(file("x".repeat(3000), "a.tex"), ACCEPT, 2048)).toBe("That file is over the 2 KiB limit.");
  });
});

describe("formatBytes", () => {
  it("uses B, KiB and MiB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KiB");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(5 * 1_048_576)).toBe("5 MiB");
  });
});

describe("readFileText", () => {
  it("reads UTF-8 text", async () => {
    expect(await readFileText(file("Résumé ✓", "a.tex"))).toBe("Résumé ✓");
  });
});

describe("outputNameFor", () => {
  it("swaps the extension and sanitizes", () => {
    expect(outputNameFor("my cv.tex", "docx")).toBe("my cv.docx");
    expect(outputNameFor("notes.txt", "pdf")).toBe("notes.pdf");
    expect(outputNameFor("../../evil/../x.tex", "pdf")).toBe("x.pdf");
    expect(outputNameFor('we"ird<name>.tex', "pdf")).toBe("weirdname.pdf");
    expect(outputNameFor("photo.final.png", "webp")).toBe("photo.final.webp");
    expect(outputNameFor(null, "pdf")).toBe("result.pdf");
    expect(outputNameFor(".tex", "pdf")).toBe("result.pdf");
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createToolMaster } from "../../../../core/index.mjs";
import tool from "../../tool.mjs";
import { docxParagraphs, docxPart } from "../docx-parts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tm = await createToolMaster({ env: { ...process.env, TOOLMASTER_TIMEOUT_MS: "60000" }, tools: [tool] });
const ready = (await tm.runner.status({ fresh: true }))["latex-to-docx"].ready;
const opts = { skip: ready ? false : "pandoc not installed (node bin/toolmaster.mjs install latex-to-docx)" };

const toDocx = async (input) => (await tm.runner.run("latex-to-docx", { input })).data;

/** Structure every resume-style document must keep: no LaTeX debris, headings, bullets, links. */
function assertResumeShape(docx, label) {
  const paras = docxParagraphs(docx);
  const text = paras.map((p) => p.text).join("\n");
  assert.ok(paras.some((p) => p.style === "Heading1"), `${label}: section headings`);
  assert.ok(paras.some((p) => p.bullet), `${label}: bullet lists`);
  assert.ok(docxPart(docx, "word/document.xml").includes("<w:hyperlink"), `${label}: links`);
  assert.ok(!/\\[A-Za-z]+/.test(text), `${label}: leftover LaTeX command: ${/\\[A-Za-z]+/.exec(text)?.[0]}`);
  assert.ok(!/[{}]/.test(text), `${label}: leftover braces`);
  return { paras, text };
}

test("a resume-style document keeps headings, bullets, links, bold roles and symbols", opts, async () => {
  const { paras, text } = assertResumeShape(await toDocx(await readFile(path.join(here, "../fixtures/resume.tex"), "utf8")), "fixture");
  assert.deepEqual(paras.filter((p) => p.style === "Heading1").map((p) => p.text), ["Professional Summary", "Core Skills", "Professional Experience", "Education"]);
  assert.equal(paras.filter((p) => p.bullet).length, 3);
  assert.match(text, /SQL & reporting; cut cycle time by 30%\./);
  assert.match(text, /Jan 2025 – Present\nExample Corp, US/);
  assert.match(text, /Analysis: Requirements, user stories, process mapping\nData: SQL/);
});

// Point TOOLMASTER_SAMPLES_DIR at a folder of real .tex/.txt files to run them through the same checks (nothing from it is stored).
const samplesDir = process.env.TOOLMASTER_SAMPLES_DIR;
const samples = samplesDir ? (await readdir(samplesDir)).filter((f) => /\.(tex|latex|txt)$/i.test(f)).sort() : [];
for (const file of samples) {
  test(`sample ${file} converts with its structure intact`, opts, async () => {
    const { paras } = assertResumeShape(await toDocx(await readFile(path.join(samplesDir, file), "utf8")), file);
    assert.ok(paras.length >= 10, "has real content");
  });
}

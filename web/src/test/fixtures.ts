import type { ToolInfo } from "../types";

export const textTool = (overrides: Partial<ToolInfo> = {}): ToolInfo => ({
  id: "text-tool",
  name: "Text Tool",
  description: "Turns text into a PDF",
  category: "Documents",
  icon: "T",
  tags: ["text", "pdf"],
  input: { kind: "text", accept: [".tex", ".txt"] },
  output: { contentType: "application/pdf", extension: "pdf" },
  preview: "file",
  options: [{ id: "mode", label: "Input type", type: "enum", values: ["auto", "latex", "text"], default: "auto" }],
  ui: { action: "Compile" },
  sample: "\\documentclass{article} sample",
  status: { ready: true, engines: [{ id: "e", found: true, version: "E 1.0" }] },
  ...overrides,
});

export const docxTool = (overrides: Partial<ToolInfo> = {}): ToolInfo =>
  textTool({
    id: "docx-tool",
    name: "Docx Tool",
    description: "Turns text into a Word file",
    category: "Documents",
    tags: ["word"],
    output: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx" },
    preview: "html",
    options: [
      { id: "mode", label: "Input type", type: "enum", values: ["auto", "latex"], default: "auto" },
      { id: "toc", label: "Add a table of contents", type: "boolean", default: false },
    ],
    ui: { action: "Convert" },
    ...overrides,
  });

export const binaryTool = (overrides: Partial<ToolInfo> = {}): ToolInfo =>
  textTool({
    id: "binary-tool",
    name: "Binary Tool",
    description: "Shrinks images",
    category: "Images",
    icon: "B",
    tags: ["image"],
    input: { kind: "binary", accept: [".png", ".jpg"] },
    output: { contentType: "image/png", extension: "png" },
    preview: "none",
    options: [],
    sample: undefined,
    ui: { action: "Shrink" },
    ...overrides,
  });

export const missingEngine = (tool: ToolInfo): ToolInfo => ({ ...tool, status: { ready: false, engines: [{ id: "e", found: false }] } });

/** A file in, readable text out (like doc-to-markdown), with a free-text option (like pdf-pages). */
export const readerTool = (overrides: Partial<ToolInfo> = {}): ToolInfo =>
  binaryTool({
    id: "reader-tool",
    name: "Reader Tool",
    description: "Reads documents",
    useWhen: "You must read a document",
    category: "AI Helpers",
    icon: "R",
    tags: ["read"],
    input: { kind: "binary", accept: [".pdf", ".docx"] },
    output: { contentType: "text/markdown", extension: "md" },
    preview: "text",
    options: [
      { id: "pages", label: "Pages", type: "string", default: "all", maxLength: 40, help: "like 1-3" },
      { id: "markers", label: "Mark pages", type: "boolean", default: true },
    ],
    ui: { action: "Read it" },
    ...overrides,
  });

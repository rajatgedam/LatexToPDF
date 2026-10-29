# AGENTS.md: how an AI agent should use ToolMaster

ToolMaster is a set of small, tested, sandboxed local tools. **Before writing a one-off script** (pdftotext, PyPDF, python-docx,
pandoc wrappers, pdflatex calls) check whether a tool already does it. The full list is in [TOOLS.md](TOOLS.md), generated from
the code, so it is always current.

## Pick the tool

| You need to... | Run |
| --- | --- |
| read what is inside a PDF, DOCX, PPTX, XLSX, EPUB, ODT, RTF, HTML, CSV | `doc-to-markdown` |
| keep, drop, reorder, repeat or rotate PDF pages (splitting = extracting a range) | `pdf-pages` |
| turn LaTeX into a PDF (resume, paper) | `latex-to-pdf` |
| turn LaTeX into an editable Word file | `latex-to-docx` |

## Three ways to call it (same tools, same options)

1. **MCP (best for agents).** Run `node bin/toolmaster.mjs mcp` (or `toolmaster mcp` from a download). In VS Code the workspace
   file [.vscode/mcp.json](.vscode/mcp.json) already registers it. Every tool appears with a typed input schema.
   Arguments: `input_path` or `input_text`, optional `output_path`, plus the tool's options. Text results come back inline.
   Files must be inside the working folder or the temp folder (`TOOLMASTER_MCP_ROOTS` allows more).
2. **CLI.** `toolmaster <tool> -i <input|-> -o <output|-> [-O option=value ...] --json`. `-o -` prints text results (Markdown)
   to stdout. `--json` prints one JSON object: `{ ok, outputPath, bytes, meta, warnings }` or `{ ok:false, error:{ code, message, log } }`.
   Run `toolmaster help <tool> --json` for the options, `toolmaster list --json` for everything.
3. **HTTP.** `toolmaster ui` serves `GET /api/tools` and `POST /api/tools/<id>/run` on 127.0.0.1 (see README).

Exit codes: 0 ok, 2 bad input (read `error.message`, fix the call), 3 policy violation, 4 the tool failed (read `error.log`),
5 timeout, 6 engine missing (`toolmaster install`), 7 busy (retry).

## Examples

```sh
toolmaster doc-to-markdown -i resume.pdf -o -                     # read a PDF as Markdown, page markers included
toolmaster doc-to-markdown -i deck.pptx -o deck.md --json
toolmaster pdf-pages -i big.pdf -o part.pdf -O pages=3-7 --json   # split out pages 3 to 7
toolmaster pdf-pages -i in.pdf -o out.pdf -O pages=all,!2 -O rotate=90
toolmaster latex-to-pdf -i resume.tex -o resume.pdf --json
```

`pages` accepts `3`, `2-5`, `5-2` (reversed), `r1` (last page), `end`, `4-end`, `odd`, `even`, `all`, and `!` to remove
(`all,!2`). Page numbers are checked against the real page count and errors say how many pages the file has.

## Rules for working in this repository

- Tools live in `tools/<id>/` and import only `core/sdk.mjs`. A tool that parses untrusted files in JavaScript must do that in a
  worker (`workers` + `ctx.isolate`), which runs in a separate, sandboxed process. External programs go in `engines/<id>.mjs`
  and run only through `ctx.exec`.
- After changing any manifest run `npm run catalog` (a test fails when TOOLS.md is stale).
- Test first, keep unit tests hermetic, keep coverage at 80% or more: `npm test`, `npm run coverage`.
- Never commit personal files (resumes under `VKProfile/`), engines (`vendor/`) or build output (`dist/`).
- Read [handoff/ARCHITECTURE.md](handoff/ARCHITECTURE.md) and [handoff/SECURITY_RULES.md](handoff/SECURITY_RULES.md) before touching the core.
  Update the files in [handoff/](handoff/) after each milestone.

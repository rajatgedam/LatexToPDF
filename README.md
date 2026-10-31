# ToolMaster

A menu of small, free tools that run **entirely on your machine**. Pick a tool in the web app, a terminal menu, a CLI command, an MCP client (AI agents) or the Node API. Nothing is uploaded. Every tool is a self-contained module, so you can ship (and download) just the ones you need.

| Tool | id | In → Out | Runs on |
| --- | --- | --- | --- |
| LaTeX to PDF | `latex-to-pdf` | `.tex` `.latex` `.txt` → `.pdf` | [Tectonic](https://github.com/tectonic-typesetting/tectonic) (MIT) |
| LaTeX to DOCX | `latex-to-docx` | `.tex` `.latex` `.txt` → `.docx` | [Pandoc](https://pandoc.org) (GPL-2.0+, separate program) |
| PDF Pages | `pdf-pages` | `.pdf` → `.pdf` (pick, reorder, reverse, repeat, delete, rotate pages; splitting = extracting a range) | built in (pdf-lib, in a sandboxed worker) |
| Doc to Markdown | `doc-to-markdown` | PDF, DOCX, PPTX, XLSX, ODT, EPUB, RTF, HTML, CSV, TSV, LaTeX, notebooks → `.md` for AI to read | Pandoc + pdf.js (in a sandboxed worker) |

The full, generated catalog (options, examples, licences) is [TOOLS.md](TOOLS.md). AI agents: read [AGENTS.md](AGENTS.md).

Status: built and tested on macOS arm64; Linux and Windows are exercised by CI and the release smoke tests. The OS sandbox is macOS-only (see Security).

## For AI agent sessions: call it instead of scripting it

Agents often write throwaway scripts at runtime to read a PDF, cut pages or convert a document. These tools do that deterministically, with checks and a sandbox, so the call is one line. Three equivalent entry points:

### 0. One-time check (do this first)

```bash
cd <repo>/ToolMaster
node bin/toolmaster.mjs doctor --json        # {"ok":true,"tools":{"latex-to-pdf":{"ready":true,...},...}}
node bin/toolmaster.mjs list --json          # every tool, its options, use-when hint and readiness
```

If a tool is not `ready`: `node bin/toolmaster.mjs install [tool ...]` (SHA-256 verified downloads). From a fresh source checkout run `npm run setup` once first (installs the two pinned PDF libraries and the engines, and builds the web app); without it `pdf-pages` and PDF reading fail with "Cannot find package". Node >= 22.13 for a source checkout or a lite download; the single-executable downloads need no Node.

### 1. MCP server (best for agents)

`toolmaster mcp` speaks the [Model Context Protocol](https://modelcontextprotocol.io) over stdio and turns every tool's manifest into an MCP tool with a typed input schema (so new tools appear with no extra code).

VS Code: this repository already contains `.vscode/mcp.json`. Other clients: register the command `node /abs/path/ToolMaster/bin/toolmaster.mjs mcp` (or `/abs/path/toolmaster mcp` from a download).

Arguments: `input_path` (a file) or `input_text` (text tools), optional `output_path`, plus the tool's options. A text result (Markdown) with no `output_path` comes back inline; a binary result with no `output_path` is written to a temp file whose path is returned. File access is **confined** to the working folder and the temp folder; set `TOOLMASTER_MCP_ROOTS` (path-delimited list) to allow other folders. Symlinks cannot be used to escape.

### 2. CLI

```bash
node bin/toolmaster.mjs doc-to-markdown -i report.pdf -o -                      # Markdown to stdout, with <!-- page N --> markers
node bin/toolmaster.mjs doc-to-markdown -i deck.pptx -o /abs/out/deck.md --json
node bin/toolmaster.mjs pdf-pages -i big.pdf -o /abs/out/part.pdf -O pages=3-7 --mkdir --json
node bin/toolmaster.mjs pdf-pages -i in.pdf -o out.pdf -O pages=r1,1-r2 -O rotate=90
node bin/toolmaster.mjs latex-to-pdf  -i resume.tex -o /abs/out/resume.pdf  --mkdir --json
node bin/toolmaster.mjs latex-to-docx -i resume.tex -o /abs/out/resume.docx -O toc=true --json
cat resume.tex | node bin/toolmaster.mjs latex-to-docx -i - -o out.docx --json     # stdin
node bin/toolmaster.mjs sample latex-to-pdf > known-good.tex                        # a known-good input
node bin/toolmaster.mjs help pdf-pages --json                                       # options, types, use-when
```

`toolmaster <tool> ...` is the same as `toolmaster run <tool> ...`.

| Flag | Meaning |
| --- | --- |
| `-i, --input <path or ->` | input file, or `-` for stdin (text tools: max 1 MiB; PDFs and documents: max 25 MiB) |
| `-o, --output <path or ->` | must end in the tool's extension; overwritten atomically; no symlinks or directories. `-` prints a **text** result to stdout (with `--json` it is the `content` field) |
| `-O key=value` | tool option, repeatable (`-O mode=latex`, `-O toc`, `-O pages=2-4`) |
| `--mkdir` | create missing parent folders of `--output` |
| `--timeout <ms>` | default 60000 |
| `--json` | one JSON object on stdout for success and failure |

Success: `{"ok":true,"tool":"pdf-pages","outputPath":"...","bytes":4473,"meta":{"sourcePages":4,"pages":2},"durationMs":407,"warnings":[]}`
Failure: `{"ok":false,"error":{"code":"INPUT_INVALID","message":"Page \"99\" in \"99\" does not exist: the document has 4 pages"}}`

Exit codes: `0` ok, `1` unexpected, `2` bad usage/input/output path/unknown tool, `3` policy violation (forbidden LaTeX construct), `4` tool failed (read `error.log`), `5` timeout, `6` engine missing, `7` busy.

Options per tool (`toolmaster help <tool>` or [TOOLS.md](TOOLS.md)):

| Tool | Option | Values | Meaning |
| --- | --- | --- | --- |
| `latex-to-pdf`, `latex-to-docx` | `mode` | `auto` (default), `latex`, `text` (PDF also `fragment`) | how to interpret the input |
| `latex-to-docx` | `toc` | `true`/`false` | add a table of contents |
| `pdf-pages` | `pages` | `all`, `3`, `2-5`, `5-2`, `r1`, `4-end`, `odd`, `even`, `!2` (remove) ... comma-separated | pages to keep, in the order written (`r1,1-r2` moves the last page first; `all,!2` drops page 2) |
| `pdf-pages` | `rotate` | `0` `90` `180` `270` | rotate the kept pages |
| `doc-to-markdown` | `type` | `auto` (sniffs the bytes), `pdf`, `docx`, `pptx`, `xlsx`, `odt`, `epub`, `html`, `rtf`, `csv`, `tsv`, `latex`, `ipynb`, `text` | override detection |
| `doc-to-markdown` | `markers` | `true`/`false` | `<!-- page N -->` between PDF pages |

### 3. Node API

```js
import { createToolMaster } from "/abs/path/to/ToolMaster/core/index.mjs";

const tm = await createToolMaster();                        // discovers tools/* and engines/*, reads TOOLMASTER_* env
const r = await tm.runner.runToFile({ tool: "pdf-pages", input: "in.pdf", output: "/abs/out/part.pdf", options: { pages: "1-2" }, mkdir: true });
// { outputPath, bytes, meta, warnings, durationMs }

const { data, meta } = await tm.runner.run("latex-to-pdf", { input: latexString, options: { mode: "latex" } });  // data is a Buffer
const md = await tm.runner.runFromSource({ tool: "doc-to-markdown", input: "report.pdf" });                        // md.data.toString()
```

Errors are `ToolMasterError` with `.code` in `CONFIG_INVALID`, `INPUT_EMPTY`, `INPUT_TOO_LARGE`, `INPUT_INVALID`, `POLICY_VIOLATION`, `TOOL_NOT_FOUND`, `TOOL_INVALID`, `ENGINE_NOT_FOUND`, `TOOL_FAILED`, `TIMEOUT`, `OUTPUT_TOO_LARGE`, `OUTPUT_PATH_INVALID`, `BUSY`. Pass exactly one of `input` (path) or `source` (data).

### 4. HTTP API (while `toolmaster ui --no-open` runs)

```bash
curl -s http://127.0.0.1:5757/api/tools                       # catalog + readiness
curl -s -X POST http://127.0.0.1:5757/api/tools/latex-to-pdf/run -H 'content-type: application/json' \
  -d '{"input":"\\documentclass{article}\\begin{document}Hi\\end{document}"}' -o out.pdf
curl -s -X POST 'http://127.0.0.1:5757/api/tools/pdf-pages/run?pages=3,1' -H 'content-type: application/octet-stream' --data-binary @in.pdf -o out.pdf
curl -s -X POST http://127.0.0.1:5757/api/tools/doc-to-markdown/run -H 'content-type: application/octet-stream' --data-binary @report.docx
curl -s -X POST http://127.0.0.1:5757/api/tools/latex-to-docx/preview -H 'content-type: text/plain' --data-binary @resume.tex   # HTML preview
```

`200` with the file (headers `X-ToolMaster-Duration-Ms`, `X-ToolMaster-Meta` JSON) or JSON `{"error":{"code","message","log?"}}` with 400/404/413/415/422/429/503/504. Text-input tools take JSON `{input, options}` or a raw `text/*` body with options in the query string; file-input tools take `application/octet-stream` with options in the query string. Loopback only; a foreign `Host`/`Origin` gets 403.

### Rules and gotchas for agents

- Use absolute output paths. A tool never writes anywhere except `--output`.
- Prefer `doc-to-markdown -o -` over any PDF/DOCX parsing script. A scanned PDF has no text: you get a warning that OCR is not included.
- `pdf-pages` checks every page number against the real page count; the error tells you how many pages the file has. It keeps title/author/subject; it does not keep bookmarks, forms or links.
- LaTeX to PDF compiles with XeTeX. Whole-line pdfTeX-only directives (`\pdfgentounicode=1`, `\input{glyphtounicode}`, ...) are stripped automatically and reported as `compat:` warnings.
- Forbidden on purpose for LaTeX to PDF (exit 3): `\write18`, `\write`/`\openout`/`\openin`/`\read`, `\input` of anything but a bare name, `\include`, `\csname`, `\catcode`, `\directlua`, shell/`minted`-style packages, path-like arguments (`/abs`, `..`, `~`) to `\includegraphics`/`\usepackage`/`\documentclass`. Do not work around it. Pandoc-based tools run with `--sandbox`, so documents cannot read files either.
- Each run happens in an empty temp directory: relative images and includes do not work.
- LaTeX to PDF downloads a package the first time it is used (internet needed) unless `TOOLMASTER_OFFLINE=1` with a primed cache (`toolmaster warmup`). Cold compile about 10 s, warm about 0.5 s. Pandoc and the PDF tools take well under a second.
- DOCX quality: Pandoc converts structure (headings, lists, tables, links, math). Layout-only commands are dropped, so expect an editable draft rather than a pixel copy of the PDF.
- Max text input 1 MiB, max file input 25 MiB, max output 25 MiB, 2 concurrent jobs (extra calls fail fast with `BUSY`/exit 7: retry shortly).
- Run `npm test` after changing anything here, run `npm run catalog` after changing a manifest, and update `handoff/`.

## Pick only what you need (and how small it gets)

Every tool lives in its own folder (`tools/<id>/`), every external program in `engines/<id>.mjs`, and the core never imports either directly. A build contains exactly the tools you choose, and only the engines and libraries they use. Three independent size levers:

1. **One tool, not all.** `--tools pdf-pages` leaves out everything else.
2. **Lite instead of single-executable.** `--runtime node` ships `toolmaster.cjs` and needs Node 22.13+, saving the 114 MB bundled runtime.
3. **Compressed engines.** Engines and their warmed caches are stored as Brotli packs and unpack on first use (about a second): Pandoc 186 MB → 24 MB, Tectonic 52 MB → 13 MB, Tectonic offline cache 44 MB → 6 MB. Or `--engines download` to ship none and fetch them with `toolmaster install`.

Measured on macOS arm64 (zip download):

| Download | Single executable (no Node needed) | Lite (needs Node 22.13+) |
| --- | --- | --- |
| everything (4 tools) | **79 MB** (157 MB unpacked; was 107 MB / 394 MB for 2 tools) | about 44 MB |
| `pdf-pages` only | about 36 MB | **0.4 MB**, the same file on every OS |
| `doc-to-markdown` only | about 60 MB | about 24 MB |
| `latex-to-docx` only | about 60 MB | about 24 MB |
| `latex-to-pdf` only | about 55 MB | about 19 MB |

"Everything" and "pdf-pages lite" were built and measured; the other rows are computed from the measured parts (executable about 36 MB zipped, plus the packs above). Adding a tool that needs no engine adds well under 1 MB to a bundle.

| You want | Get |
| --- | --- |
| Everything | `ToolMaster-all-<os>-<arch>.zip`, `ToolMaster-all-lite-<os>-<arch>.zip` or `ghcr.io/rajatgedam/toolmaster` |
| One tool | `ToolMaster-<tool-id>-<os>-<arch>.zip` or `ghcr.io/rajatgedam/toolmaster-<tool-id>` |
| An engine-free tool, any OS | `ToolMaster-<tool-id>-lite.zip` (for example `pdf-pages`) |
| A custom mix | `npm run package -- --tools doc-to-markdown,pdf-pages [--runtime node] [--engines download] [--zip]` or `docker build --build-arg TOOLS=a,b .` |

Platforms: macOS arm64/x64, Linux x64/arm64, Windows x64. Pandoc is GPL-2.0-or-later; it ships as a separate unmodified program, and `THIRD-PARTY-NOTICES.txt` lists every engine and bundled library with its licence text. Several downloads can share one engine folder: set `TOOLMASTER_VENDOR_DIR`.

### Add your own tool

Create `tools/<id>/tool.mjs` (tools import only `core/sdk.mjs`):

```js
import { defineTool } from "../../core/sdk.mjs";

export default defineTool({
  manifest: {
    id: "my-tool", name: "My Tool", description: "What it does", category: "Documents", icon: "🧰", tags: ["demo"],
    useWhen: "One sentence an AI can use to choose this tool instead of writing a script.",
    input: { kind: "text", accept: [".txt"] },            // or "binary" (a file), optionally with maxBytes
    output: { contentType: "text/plain", extension: "txt" },
    preview: "none",                                        // "file" | "html" | "text" | "none"
    options: [
      { id: "shout", label: "Shout", type: "boolean", default: false },
      { id: "pages", label: "Pages", type: "string", default: "all", maxLength: 100, help: "like 1-3" },   // also "enum"
    ],
    engines: [],                                            // ids from engines/*.mjs, e.g. ["pandoc"]
    ui: { action: "Run" },
  },
  async run(ctx, { input, options }) {
    return { data: Buffer.from(options.shout ? input.toUpperCase() : input), meta: {}, warnings: [] };
  },
});
```

It then shows up in the menu, the CLI, the HTTP API, the MCP server and the web app with no other change. Then add a case in `scripts/smoke-bundle.mjs` and `scripts/smoke-http.mjs` (a test fails until you do) and run `npm run catalog`.

- A **new external program**: add `engines/<id>.mjs` (pinned URLs + SHA-256), name it in `engines: ["<id>"]`, and run it with `ctx.exec({ engine, ... })`. Two tools that name the same engine share one download.
- **Parsing untrusted files in JavaScript**: put the work in `workers: { job: async ({ dir }) => result }` and call `ctx.isolate({ job, files, outputs })`. It runs in a separate, sandboxed process with a heap limit, no network and no access to your files (see `tools/pdf-pages`).

See `handoff/ARCHITECTURE.md`, section "Adding a tool".

## Configuration

All optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TOOLMASTER_PORT` | 5757 | web app port (a free port is used if busy and unset) |
| `TOOLMASTER_HOST` | 127.0.0.1 | bind address; non-loopback also needs `TOOLMASTER_ALLOW_REMOTE=1` and `TOOLMASTER_ALLOWED_HOSTS` |
| `TOOLMASTER_TOOLS` | all found | comma list of tool ids to enable |
| `TOOLMASTER_MAX_INPUT_BYTES` | 1048576 | max text input (a tool manifest may set its own, as file tools do) |
| `TOOLMASTER_MAX_OUTPUT_BYTES` | 26214400 | max output size |
| `TOOLMASTER_TIMEOUT_MS` | 60000 | per-job timeout |
| `TOOLMASTER_MAX_CONCURRENCY` | 2 | parallel jobs |
| `TOOLMASTER_RATE_LIMIT_PER_MIN` | 60 | per-IP HTTP rate limit |
| `TOOLMASTER_OFFLINE` | 0 | `1` = no network for engines that can use it (cached packages only) |
| `TOOLMASTER_SANDBOX` | auto | `auto` / `on` / `off` (macOS Seatbelt sandbox for engines and workers) |
| `TOOLMASTER_ENGINE_<ID>` | auto | path to an engine binary, e.g. `TOOLMASTER_ENGINE_PANDOC` |
| `TOOLMASTER_VENDOR_DIR` | `<install>/vendor` | where engines are unpacked/installed; share one folder between downloads |
| `TOOLMASTER_CACHE_DIR` | `<vendor>/cache` | where engines keep package caches |
| `TOOLMASTER_MCP_ROOTS` | working folder + temp folder | folders the MCP server may read and write (path-delimited) |

## Security (summary; rules live in `handoff/SECURITY_RULES.md`)

Based on OWASP Top 10 and Cloudflare-style edge controls applied in-process: loopback bind, Host/Origin allowlists (DNS rebinding and CSRF), no CORS, strict CSP and security headers, per-IP rate limit, streaming body cap, content-type allowlist, generic error bodies, safe static serving. **Everything that parses untrusted input runs in a separate process through one hardened path**: isolated temp dir, scrubbed environment, timeout with process-group kill, size caps, heap limit, concurrency cap, and on macOS a Seatbelt sandbox that blocks reading your home folder, listing `/Users`, using the network and writing outside the work and cache folders. This covers external programs (Pandoc, Tectonic) and the JavaScript PDF parsers alike. LaTeX to PDF adds a static policy scan and Tectonic `--untrusted`; Pandoc runs with `--sandbox`; previews are script-less and network-less. The MCP server confines file access to allowed folders. Supply chain: two pinned runtime libraries (bundled, licences shipped), engines pinned by SHA-256 and verified again by pack checksums, SHA-pinned CI actions, `npm audit` clean, build provenance attestations on releases.

Known limits: on Linux/Windows there is no OS sandbox yet, so the process boundary, timeouts, heap limit and tool-level controls (the LaTeX policy scan, Pandoc `--sandbox`) are the barrier there; run the Docker image for stronger isolation. Tectonic `--untrusted` still allows absolute-path `\input`.

## Development

```bash
npm run setup          # install engines + web deps + build the web app
npm test               # unit (hermetic, fake engines) + integration (real engines) + web (Vitest)
npm run coverage       # backend coverage gate: >= 80% lines on core/ and tools/ (currently about 99%)
npm --prefix web run coverage
npm --prefix web run dev     # web dev server on :5173 (proxy to the API on :5757)
npm run catalog        # regenerate TOOLS.md after changing a manifest
npm run package -- --tools all --zip    # build a download (slow with --zip: maximum Brotli compression)
node scripts/smoke-bundle.mjs dist/<bundle-folder>    # run the same smoke test CI runs
```

Repo map and decisions: `handoff/ARCHITECTURE.md`. Research behind the design (similar systems, papers, measurements): `handoff/RESEARCH.md`. Progress and findings: `handoff/PROGRESS.md`. Latest session notes: newest `handoff/HANDOFF_*.md`. Design language: `handoff/DESIGN_LANGUAGE.md`. Test first, keep coverage at 80%+, update `handoff/` after each milestone.

---

## Running it yourself (humans)

### Option A: download a release (any OS, no Node, no Docker)

Open the repository's Releases page, download the zip for your system (see "Pick only what you need"), unzip, and double-click `ToolMaster.command` (macOS), `ToolMaster.sh` (Linux) or `ToolMaster.bat` (Windows). Your browser opens the tool menu. Check the zip against `SHA256SUMS.txt`; release files also carry build-provenance attestations (`gh attestation verify <zip> -R rajatgedam/ToolMaster`). Builds are unsigned, so macOS/Windows may warn on first run; on macOS run `xattr -dr com.apple.quarantine <folder>` once. The first run unpacks the engines (about a second).

Prefer the terminal? Run `./toolmaster` (no arguments) for an interactive menu: pick a tool, type the input path and options, get the file. `./toolmaster ui` opens the web app, `./toolmaster list` shows what is inside. Have Node 22.13+ and want a small download? Take a `-lite` zip; the launcher scripts are the same.

### Option B: Docker (any OS)

```bash
docker run --rm -p 127.0.0.1:5757:5757 ghcr.io/rajatgedam/toolmaster
# one tool: ghcr.io/rajatgedam/toolmaster-pdf-pages  (or -doc-to-markdown, -latex-to-docx, -latex-to-pdf)
# hardened: add  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges
# keep downloaded packages: add  -v toolmaster-cache:/app/vendor/cache  (drop --read-only on the first run)
```

Open `http://127.0.0.1:5757`. Always publish the port on `127.0.0.1` and keep the same port number on both sides (the server only answers to `localhost:<port>`). Or build it yourself: `docker build -t toolmaster .` (one tool: `--build-arg TOOLS=pdf-pages`).

### Option C: from this source folder (needs Node 22.13+)

Double-click `ToolMaster.command` (first run installs the engines and builds the web app), or:

```bash
npm run setup          # first time
npm start              # starts the web app and opens the browser
npm run package -- --tools pdf-pages --runtime node --zip   # build your own tiny one-tool bundle into dist/
```

### Using the web app

1. The start menu lists your tools by category. Search them, or press `/` to search and `1`-`9` to open a tool.
2. Add input on the left: paste text, or drop a file anywhere on that side, or use Open file / Load sample.
3. Set options if the tool has any (for example the pages to keep), then press the action button (Compile, Make PDF, Read it, ...) or Ctrl/Cmd + Enter. Auto-run re-runs a moment after you stop typing in text tools.
4. The result shows on the right (a PDF viewer, an HTML preview, or readable text with a Copy button); press Download to save it. If something fails, the details appear on the right.

Stop the app with Ctrl+C in its terminal window.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| A tool card says "Needs setup" | `toolmaster install <tool>` (or the menu's "Install or repair engines") |
| First LaTeX to PDF run takes about 10 s | Tectonic is downloading packages once; later runs are fast |
| First run of a download takes a second longer | The engines are unpacking from their compressed packs; once only |
| "needs Node.js 22.13" from a lite download | Install Node from nodejs.org, or take the single-executable download |
| Port busy | The app picks a free port automatically; or set `TOOLMASTER_PORT` |
| "Forbidden LaTeX construct" | You used a file/shell primitive that is disabled for safety; remove it |
| "This PDF is password-protected" | Remove the password first; the tools do not guess or bypass it |
| Doc to Markdown says "scanned PDF" | The PDF is only images; OCR is not included |
| Works online, fails offline | Run `toolmaster warmup` once online, then use `TOOLMASTER_OFFLINE=1` |
| DOCX looks plainer than the PDF | Expected: Pandoc keeps structure, not LaTeX layout macros |

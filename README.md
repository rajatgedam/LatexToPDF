# ToolMaster

A menu of small, free tools that run **entirely on your machine**. Pick a tool in the web app, a terminal menu, a CLI command or the Node API. Nothing is uploaded. Every tool is a self-contained module, so you can ship (and download) just the ones you need.

| Tool | id | In → Out | Engine |
| --- | --- | --- | --- |
| LaTeX to PDF | `latex-to-pdf` | `.tex` `.latex` `.txt` → `.pdf` | [Tectonic](https://github.com/tectonic-typesetting/tectonic) (MIT) |
| LaTeX to DOCX | `latex-to-docx` | `.tex` `.latex` `.txt` → `.docx` | [Pandoc](https://pandoc.org) (GPL-2.0+, downloaded separately, never bundled in git) |

Status: built and tested on macOS arm64; Linux and Windows are exercised by CI and the release smoke tests. The OS sandbox is macOS-only (see Security). The backend has zero npm runtime dependencies.

## For AI agent sessions: call it like a method

The full contract is in `handoff/ARCHITECTURE.md`. This section is enough to use the tool.

### 0. One-time check (do this first)

```bash
cd <repo>/ToolMaster
node bin/toolmaster.mjs doctor --json        # {"ok":true,"tools":{"latex-to-pdf":{"ready":true,...},...}}
node bin/toolmaster.mjs list --json          # every tool, its options and readiness
```

If a tool is not `ready`: `node bin/toolmaster.mjs install [tool ...]` (SHA-256 verified downloads). Node >= 22 for a source checkout; the portable builds need no Node.

### 1. CLI

```bash
node bin/toolmaster.mjs latex-to-pdf  -i resume.tex -o /abs/out/resume.pdf  --mkdir --json
node bin/toolmaster.mjs latex-to-docx -i resume.tex -o /abs/out/resume.docx -O toc=true --json
cat resume.tex | node bin/toolmaster.mjs latex-to-docx -i - -o out.docx --json     # stdin
node bin/toolmaster.mjs sample latex-to-pdf > known-good.tex                        # a known-good input
node bin/toolmaster.mjs help latex-to-docx                                          # options and example
```

`toolmaster <tool> ...` is the same as `toolmaster run <tool> ...`.

| Flag | Meaning |
| --- | --- |
| `-i, --input <path or ->` | input file, or `-` for stdin (UTF-8 text tools: max 1 MiB) |
| `-o, --output <path>` | must end in the tool's extension (`.pdf`, `.docx`); overwritten atomically; no symlinks or directories |
| `-O key=value` | tool option, repeatable (`-O mode=latex`, `-O toc`) |
| `--mkdir` | create missing parent folders of `--output` |
| `--timeout <ms>` | default 60000 |
| `--json` | one JSON object on stdout for success and failure |

Success: `{"ok":true,"tool":"latex-to-pdf","outputPath":"...","bytes":20690,"meta":{"pages":1,"kind":"latex"},"durationMs":379,"warnings":[...]}`
Failure: `{"ok":false,"error":{"code":"TOOL_FAILED","message":"...","log":"..."}}`

Exit codes: `0` ok, `1` unexpected, `2` bad usage/input/output path/unknown tool, `3` policy violation (forbidden LaTeX construct), `4` tool failed (read `error.log`), `5` timeout, `6` engine missing, `7` busy.

Tool options (`toolmaster help <tool>` shows them):

| Tool | Option | Values | Meaning |
| --- | --- | --- | --- |
| both | `mode` | `auto` (default), `latex`, `text` (PDF also `fragment`) | how to interpret the input; `auto` treats text containing LaTeX commands as LaTeX |
| `latex-to-docx` | `toc` | `true`/`false` | add a table of contents |

### 2. Node API

```js
import { createToolMaster } from "/abs/path/to/ToolMaster/core/index.mjs";

const tm = await createToolMaster();                        // discovers tools/*, reads TOOLMASTER_* env
const r = await tm.runner.runToFile({ tool: "latex-to-docx", input: "resume.tex", output: "/abs/out/resume.docx", mkdir: true });
// { outputPath, bytes, meta, warnings, durationMs }

const { data, meta } = await tm.runner.run("latex-to-pdf", { input: latexString, options: { mode: "latex" } });  // data is a Buffer
```

Errors are `ToolMasterError` with `.code` in `CONFIG_INVALID`, `INPUT_EMPTY`, `INPUT_TOO_LARGE`, `INPUT_INVALID`, `POLICY_VIOLATION`, `TOOL_NOT_FOUND`, `TOOL_INVALID`, `ENGINE_NOT_FOUND`, `TOOL_FAILED`, `TIMEOUT`, `OUTPUT_TOO_LARGE`, `OUTPUT_PATH_INVALID`, `BUSY`. Pass exactly one of `input` (path) or `source` (data) to `runToFile`.

### 3. HTTP API (while `toolmaster ui --no-open` runs)

```bash
curl -s http://127.0.0.1:5757/api/tools                       # catalog + readiness
curl -s -X POST http://127.0.0.1:5757/api/tools/latex-to-pdf/run -H 'content-type: application/json' \
  -d '{"input":"\\documentclass{article}\\begin{document}Hi\\end{document}"}' -o out.pdf
curl -s -X POST 'http://127.0.0.1:5757/api/tools/latex-to-docx/run?toc=true' -H 'content-type: text/plain' --data-binary @resume.tex -o out.docx
curl -s -X POST http://127.0.0.1:5757/api/tools/latex-to-docx/preview -H 'content-type: text/plain' --data-binary @resume.tex   # HTML preview
```

`200` with the file (headers `X-ToolMaster-Duration-Ms`, `X-ToolMaster-Meta` JSON) or JSON `{"error":{"code","message","log?"}}` with 400/404/413/415/422/429/503/504. Text tools take JSON `{input, options}` or a raw `text/*` body with options in the query string; binary tools take `application/octet-stream`. Loopback only; a foreign `Host`/`Origin` gets 403.

### Rules and gotchas for agents

- Use absolute output paths. A tool never writes anywhere except `--output`.
- LaTeX to PDF compiles with XeTeX. Whole-line pdfTeX-only directives (`\pdfgentounicode=1`, `\input{glyphtounicode}`, ...) are stripped automatically and reported as `compat:` warnings.
- Forbidden on purpose for LaTeX to PDF (exit 3): `\write18`, `\write`/`\openout`/`\openin`/`\read`, `\input` of anything but a bare name, `\include`, `\csname`, `\catcode`, `\directlua`, shell/`minted`-style packages, path-like arguments (`/abs`, `..`, `~`) to `\includegraphics`/`\usepackage`/`\documentclass`. Do not work around it. LaTeX to DOCX runs Pandoc with `--sandbox`, so documents cannot read files either.
- Each run happens in an empty temp directory: relative images and includes do not work.
- LaTeX to PDF downloads a package the first time it is used (internet needed) unless `TOOLMASTER_OFFLINE=1` with a primed cache (`toolmaster warmup`). Cold compile about 10 s, warm about 0.5 s. LaTeX to DOCX takes about 0.3 s.
- DOCX quality: Pandoc converts structure (headings, lists, tables, links, math). Layout-only commands (custom resume macros, `\hfill`, `\vspace`) are dropped, so expect an editable draft rather than a pixel copy of the PDF.
- Max text input 1 MiB, max output 25 MiB, 2 concurrent jobs (extra calls fail fast with `BUSY`/exit 7: retry shortly).
- Run `npm test` after changing anything here and update `handoff/`.

## Pick only what you need

Every tool lives in its own folder (`tools/<id>/`) and the core never imports a tool directly, so a build contains exactly the tools you choose.

| You want | Get |
| --- | --- |
| Everything | `ToolMaster-all-<os>-<arch>.zip` or `ghcr.io/rajatgedam/toolmaster` |
| Only LaTeX to PDF | `ToolMaster-latex-to-pdf-<os>-<arch>.zip` or `ghcr.io/rajatgedam/toolmaster-latex-to-pdf` |
| Only LaTeX to DOCX | `ToolMaster-latex-to-docx-<os>-<arch>.zip` or `ghcr.io/rajatgedam/toolmaster-latex-to-docx` |
| A custom mix | `npm run package -- --tools latex-to-pdf,latex-to-docx` or `docker build --build-arg TOOLS=a,b .` |

Measured on macOS arm64 (zip / unpacked): all 107 MB / 394 MB, DOCX only 76 MB / 298 MB, PDF only 66 MB / 207 MB. The launcher (a single-file Node runtime, 111 MB) is the fixed part; Pandoc is about 190 MB unpacked and Tectonic about 54 MB plus a 45 MB offline package cache (`--no-cache` drops it). Platforms: macOS arm64/x64, Linux x64/arm64, Windows x64. Pandoc is GPL-2.0-or-later; it ships as a separate unmodified program with its licence notice in `THIRD-PARTY-NOTICES.txt`.

### Add your own tool

Create `tools/<id>/tool.mjs`:

```js
import { defineTool } from "../../core/sdk.mjs";

export default defineTool({
  manifest: {
    id: "my-tool", name: "My Tool", description: "What it does", category: "Documents", icon: "🧰",
    input: { kind: "text", accept: [".txt"] },            // or "binary"
    output: { contentType: "text/plain", extension: "txt" },
    preview: "none",                                        // "file" | "html" | "none"
    options: [{ id: "shout", label: "Shout", type: "boolean", default: false }],
    engines: [],                                            // optional external programs (pinned URL + sha256)
    ui: { action: "Run" },
  },
  async run(ctx, { input, options }) {
    return { data: Buffer.from(options.shout ? input.toUpperCase() : input), meta: {}, warnings: [] };
  },
});
```

It then shows up in the menu, the CLI (`toolmaster my-tool -i ... -o ...`), the HTTP API and the web app with no other change. Engines run through `ctx.exec(...)` (temp dir, scrubbed env, timeout, OS sandbox). See `handoff/ARCHITECTURE.md`, section "Adding a tool".

## Configuration

All optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TOOLMASTER_PORT` | 5757 | web app port (a free port is used if busy and unset) |
| `TOOLMASTER_HOST` | 127.0.0.1 | bind address; non-loopback also needs `TOOLMASTER_ALLOW_REMOTE=1` and `TOOLMASTER_ALLOWED_HOSTS` |
| `TOOLMASTER_TOOLS` | all found | comma list of tool ids to enable |
| `TOOLMASTER_MAX_INPUT_BYTES` | 1048576 | max text input (a tool manifest may set its own) |
| `TOOLMASTER_MAX_OUTPUT_BYTES` | 26214400 | max output size |
| `TOOLMASTER_TIMEOUT_MS` | 60000 | per-job timeout |
| `TOOLMASTER_MAX_CONCURRENCY` | 2 | parallel jobs |
| `TOOLMASTER_RATE_LIMIT_PER_MIN` | 60 | per-IP HTTP rate limit |
| `TOOLMASTER_OFFLINE` | 0 | `1` = no network for engines that can use it (cached packages only) |
| `TOOLMASTER_SANDBOX` | auto | `auto` / `on` / `off` (macOS Seatbelt sandbox for engines) |
| `TOOLMASTER_ENGINE_<ID>` | auto | path to an engine binary, e.g. `TOOLMASTER_ENGINE_PANDOC` |
| `TOOLMASTER_CACHE_DIR` | `vendor/cache` | where engines keep package caches |

## Security (summary; rules live in `handoff/SECURITY_RULES.md`)

Based on OWASP Top 10 and Cloudflare-style edge controls applied in-process: loopback bind, Host/Origin allowlists (DNS rebinding and CSRF), no CORS, strict CSP and security headers, per-IP rate limit, streaming body cap, content-type allowlist, generic error bodies, safe static serving. Every external program runs through one hardened path: isolated temp dir, scrubbed environment, timeout with process-group kill, size caps, concurrency cap, and on macOS a Seatbelt sandbox that blocks reading your home folder and writing outside the work and cache folders. LaTeX to PDF adds a static policy scan and Tectonic `--untrusted`; LaTeX to DOCX adds Pandoc `--sandbox` and a script-less, network-less iframe preview. Supply chain: no runtime npm dependencies in the backend, engines pinned by SHA-256, SHA-pinned CI actions, `npm audit` clean, build provenance attestations on releases.

Known limits: on Linux/Windows there is no OS sandbox yet, so tool-level controls (the LaTeX policy scan, Pandoc `--sandbox`) are the file-read barrier there. Tectonic `--untrusted` still allows absolute-path `\input`.

## Development

```bash
npm run setup          # install engines + web deps + build the web app
npm test               # unit (hermetic, fake engines) + integration (real engines) + web (Vitest)
npm run coverage       # backend coverage gate: >= 80% lines on core/ and tools/
npm --prefix web run coverage
npm --prefix web run dev     # web dev server on :5173 (proxy to the API on :5757)
```

Repo map and decisions: `handoff/ARCHITECTURE.md`. Progress and findings: `handoff/PROGRESS.md`. Latest session notes: newest `handoff/HANDOFF_*.md`. Design language: `handoff/DESIGN_LANGUAGE.md`. Test first, keep coverage at 80%+, update `handoff/` after each milestone.

---

## Running it yourself (humans)

### Option A: download a release (any OS, no Node, no Docker)

Open the repository's Releases page, download the zip for your system (see "Pick only what you need"), unzip, and double-click `ToolMaster.command` (macOS), `ToolMaster.sh` (Linux) or `ToolMaster.bat` (Windows). Your browser opens the tool menu. Check the zip against `SHA256SUMS.txt`; release files also carry build-provenance attestations (`gh attestation verify <zip> -R rajatgedam/ToolMaster`). Builds are unsigned, so macOS/Windows may warn on first run; on macOS run `xattr -dr com.apple.quarantine <folder>` once.

Prefer the terminal? Run `./toolmaster` (no arguments) for an interactive menu: pick a tool, type the input path and options, get the file. `./toolmaster ui` opens the web app, `./toolmaster list` shows what is inside.

### Option B: Docker (any OS)

```bash
docker run --rm -p 127.0.0.1:5757:5757 ghcr.io/rajatgedam/toolmaster
# one tool: ghcr.io/rajatgedam/toolmaster-latex-to-docx  (or -latex-to-pdf)
# hardened: add  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges
# keep downloaded packages: add  -v toolmaster-cache:/app/vendor/cache  (drop --read-only on the first run)
```

Open `http://127.0.0.1:5757`. Always publish the port on `127.0.0.1` and keep the same port number on both sides (the server only answers to `localhost:<port>`). Or build it yourself: `docker build -t toolmaster .`.

### Option C: from this source folder (needs Node 22+)

Double-click `ToolMaster.command` (first run installs the engines and builds the web app), or:

```bash
npm run setup          # first time
npm start              # starts the web app and opens the browser
npm run package -- --tools latex-to-docx --zip   # build your own portable one-tool bundle into dist/
```

### Using the web app

1. The start menu lists your tools. Search them, or press `/` to search and `1`-`9` to open a tool.
2. Add input on the left: paste, drop a file anywhere on that side, or use Open file / Load sample.
3. Set options if the tool has any, then press the action button (Compile, Convert, ...) or Ctrl/Cmd + Enter. Auto-run re-runs a moment after you stop typing.
4. The result previews on the right; press Download to save it. If something fails, the details appear on the right.

Stop the app with Ctrl+C in its terminal window.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| A tool card says "Needs setup" | `toolmaster install <tool>` (or the menu's "Install or repair engines") |
| First LaTeX to PDF run takes about 10 s | Tectonic is downloading packages once; later runs are fast |
| Port busy | The app picks a free port automatically; or set `TOOLMASTER_PORT` |
| "Forbidden LaTeX construct" | You used a file/shell primitive that is disabled for safety; remove it |
| Works online, fails offline | Run `toolmaster warmup` once online, then use `TOOLMASTER_OFFLINE=1` |
| DOCX looks plainer than the PDF | Expected: Pandoc keeps structure, not LaTeX layout macros |

# LatexToPDF

Local, secure LaTeX (or plain text) to PDF. One engine, three ways in: a CLI and Node API for AI agents, an HTTP API, and a small React UI for humans. Nothing leaves your machine.

Engine: [Tectonic](https://github.com/tectonic-typesetting/tectonic) 0.17.0 (XeTeX based, MIT), installed locally by script with a pinned SHA-256. Backend has zero npm runtime dependencies.

Status: built and tested on macOS arm64. Linux/Windows code paths exist but are untested; the OS sandbox is macOS-only (see Security).

## For AI agent sessions: call it like a method

Read `handoff/ARCHITECTURE.md` for the full contract. Everything below is enough to use the tool.

### 0. One-time check (do this first)

```bash
cd <repo>/LatexToPDF
node bin/latex2pdf.mjs --check --json     # {"ok":true,"engine":{"found":true,"version":"Tectonic 0.17.0"}}
```

If `found` is false: `npm run install:engine` (downloads about 20 MB, verifies SHA-256). Node >= 22 is required for a source checkout. The portable build (see bottom) needs no Node.

### 1. CLI (preferred for agents)

```bash
node bin/latex2pdf.mjs -i resume.tex -o /abs/path/out/resume.pdf --mkdir --json
cat resume.tex | node bin/latex2pdf.mjs -i - -o out.pdf --json     # stdin
```

| Flag | Meaning |
| --- | --- |
| `-i, --input <path or ->` | `.tex`/`.txt` file, or `-` for stdin (UTF-8, max 1 MiB) |
| `-o, --output <path>` | must end in `.pdf`; overwritten atomically; no symlinks/directories |
| `-m, --mode` | `auto` (default), `latex`, `fragment`, `text` |
| `--mkdir` | create missing parent folders of `--output` |
| `--timeout <ms>` | default 60000 |
| `--json` | one JSON object on stdout (success and failure) |

Success: `{"ok":true,"outputPath":"...","bytes":20690,"pages":1,"durationMs":379,"warnings":[...]}`
Failure: `{"ok":false,"error":{"code":"COMPILE_FAILED","message":"...","log":"..."}}`

Exit codes: `0` ok, `1` unexpected, `2` bad usage/input/output path, `3` policy violation (forbidden LaTeX construct), `4` compile failed (read `error.log`), `5` timeout, `6` engine missing, `7` busy.

Input modes: `auto` treats text containing `\documentclass` as a full document, text with other LaTeX commands as a fragment (wrapped in an article preamble), and anything else as plain text (all special characters escaped). Force with `-m`.

### 2. Node API

```js
import { compileToFile, compile, LatexToPdfError } from "/abs/path/to/LatexToPDF/src/index.mjs";

const r = await compileToFile({ input: "resume.tex", output: "/abs/out/resume.pdf", mkdir: true });
// { outputPath, bytes, pages, durationMs, warnings, kind }

const { pdf, pages } = await compile({ source: latexString });   // pdf is a Buffer

try { await compile({ source }); } catch (e) {
  if (e instanceof LatexToPdfError) console.log(e.code, e.message, e.log);
}
```

Error codes: `CONFIG_INVALID`, `INPUT_EMPTY`, `INPUT_TOO_LARGE`, `INPUT_INVALID`, `POLICY_VIOLATION`, `ENGINE_NOT_FOUND`, `COMPILE_FAILED`, `TIMEOUT`, `OUTPUT_TOO_LARGE`, `OUTPUT_PATH_INVALID`, `BUSY`. Pass exactly one of `input` or `source` to `compileToFile`.

### 3. HTTP API (when the UI server is running: `node bin/latex2pdf-ui.mjs --no-open`)

```bash
curl -s -X POST http://127.0.0.1:5757/api/compile -H 'content-type: application/json' \
  -d '{"source":"\\documentclass{article}\\begin{document}Hi\\end{document}"}' -o out.pdf
curl -s -X POST http://127.0.0.1:5757/api/compile -H 'content-type: text/plain' --data-binary @resume.tex -o out.pdf
```

`200 application/pdf` (headers `X-Latex2pdf-Pages`, `X-Latex2pdf-Duration-Ms`) or JSON `{"error":{"code","message","log?"}}` with 400/413/415/422/429/503/504. `GET /api/health` reports the engine. Loopback only; requests with a foreign `Host`/`Origin` get 403.

### Rules and gotchas for agents

- Use absolute output paths. The tool never writes anywhere except `--output`.
- It compiles with XeTeX. Whole-line pdfTeX-only directives (`\pdfgentounicode=1`, `\input{glyphtounicode}`, ...) are stripped automatically and reported as `compat:` warnings.
- Forbidden on purpose (exit 3 / `POLICY_VIOLATION`): `\write18`, `\write`/`\openout`/`\openin`/`\read`, `\input` of anything but a bare name, `\include`, `\csname`, `\catcode`, `\directlua`, `shellesc`/`minted`/`catchfile` and similar packages, path-like arguments (`/abs`, `..`, `~`) to `\includegraphics`/`\usepackage`/`\documentclass`. Do not try to work around it.
- Relative images/includes do not work: each compile runs in an empty temp directory.
- First use of a new LaTeX package downloads it (needs internet) unless `LATEX2PDF_OFFLINE=1` with a primed cache (`npm run warmup`). Cold compile about 10 s, warm about 0.5 s.
- Example input that is known good: `examples/resume.tex`.
- Max source 1 MiB, max PDF 25 MiB, 2 concurrent compiles (extra calls fail fast with `BUSY`/exit 7: retry after a moment).
- Run `npm test` after changing anything in this repo, and update `handoff/` (see below).

## Configuration

All optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `LATEX2PDF_PORT` | 5757 | UI server port (random free port if busy and unset) |
| `LATEX2PDF_HOST` | 127.0.0.1 | Bind address; non-loopback also needs `LATEX2PDF_ALLOW_REMOTE=1` and `LATEX2PDF_ALLOWED_HOSTS` |
| `LATEX2PDF_MAX_INPUT_BYTES` | 1048576 | Max source size |
| `LATEX2PDF_MAX_OUTPUT_BYTES` | 26214400 | Max PDF size |
| `LATEX2PDF_TIMEOUT_MS` | 60000 | Compile timeout |
| `LATEX2PDF_MAX_CONCURRENCY` | 2 | Parallel compiles |
| `LATEX2PDF_RATE_LIMIT_PER_MIN` | 60 | Per-IP HTTP rate limit |
| `LATEX2PDF_ENGINE` | auto | Path to a tectonic binary |
| `LATEX2PDF_OFFLINE` | 0 | `1` = no network (cached packages only) |
| `LATEX2PDF_SANDBOX` | auto | `auto` / `on` / `off` (macOS Seatbelt sandbox for the engine) |
| `TECTONIC_CACHE_DIR` | `vendor/tectonic-cache` | Package cache location |

## Security (summary; rules live in `handoff/SECURITY_RULES.md`)

Based on OWASP Top 10 and Cloudflare-style edge controls applied in-process: loopback bind, Host/Origin allowlists (DNS rebinding and CSRF), no CORS, strict CSP and security headers, per-IP rate limit, streaming body cap, content-type allowlist, generic error bodies, static path traversal and symlink protection. Compilation: static policy scan, Tectonic `--untrusted`, isolated temp dir, scrubbed environment, timeout with process-group kill, size caps, concurrency cap, and on macOS a Seatbelt sandbox that blocks reading your home folder and writing outside the work/cache folders. Supply chain: no runtime npm dependencies in the backend, engine pinned by SHA-256, `npm audit` clean.

Known limits: on Linux/Windows there is no OS sandbox yet, so the policy scan is the only file-read barrier there (Tectonic `--untrusted` still allows absolute-path `\input`).

## Development

```bash
npm run setup          # engine + web install + web build
npm test               # unit (hermetic, fake engine) + integration (real engine) + web (Vitest)
npm run coverage       # backend coverage gate: >= 80% lines on src/
npm --prefix web run coverage
npm --prefix web run dev     # UI dev server on :5173 (proxy to API on :5757)
```

Repo map and decisions: `handoff/ARCHITECTURE.md`. Progress and findings: `handoff/PROGRESS.md`. Latest session notes: newest `handoff/HANDOFF_*.md`. UI design language: `handoff/DESIGN_LANGUAGE.md`. Test-first, keep coverage at 80%+, update `handoff/` after each milestone.

---

## Running it yourself (humans)

### Option A: portable app (no Node needed)

Build once on your Mac (about a minute), then it runs from any folder:

```bash
npm run setup                      # first time only
npm run package                    # add -- --zip to also make a zip, -- --no-cache for a smaller folder
open dist/LatexToPDF-darwin-arm64  # double-click LatexToPDF.command
```

The folder (about 200 MB: 111 MB single-file launcher, 54 MB engine, 45 MB offline package cache) is self-contained. Copy it anywhere, even to another Mac of the same CPU type. If macOS says it can't verify the app, run `xattr -dr com.apple.quarantine <folder>` once. Double-clicking opens your browser at `http://127.0.0.1:5757`.

The same binary is also the CLI: `./latex2pdf -i resume.tex -o resume.pdf --json`.

### Option B: from this source folder (needs Node 22+)

Double-click `LatexToPDF.command` (first run installs the engine and builds the UI), or:

```bash
npm run setup          # first time
npm start              # starts the server and opens the browser
```

### Using the app

1. Paste LaTeX on the left, or drop a `.tex`/`.txt` file anywhere on that side (or press Open file / Load sample).
2. Press Compile (or Cmd/Ctrl + Enter). Turn on Auto-compile to rebuild a moment after you stop typing.
3. The PDF previews on the right. Press Download PDF to save it.
4. If LaTeX complains, the error log appears on the right.

Stop the app with Ctrl+C in its terminal window.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Engine missing" in the footer | `npm run install:engine` |
| First compile takes about 10 s | Tectonic is downloading packages once; later runs are fast |
| Port busy | The app picks a free port automatically; or set `LATEX2PDF_PORT` |
| Compile blocked as "Forbidden LaTeX construct" | You used a file/shell primitive that is disabled for safety; remove it |
| Works online, fails offline | Run `npm run warmup` once online, then use `LATEX2PDF_OFFLINE=1` |


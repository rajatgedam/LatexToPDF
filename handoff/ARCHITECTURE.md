# Architecture (source of truth)

If code and this file disagree, fix one of them in the same commit. Last verified: 2026-10-28 (M1, M2, M3 built and verified; M4 packaging is still design, marked [planned]).

## Goal

Local-only tool that turns LaTeX (or plain text) into a PDF. Three entry points share one core:

| Entry point | Audience | Command |
| --- | --- | --- |
| Importable API | Other AI agent sessions (Node) | `import { compileToFile } from "<repo>/src/index.mjs"` |
| CLI | Agents / scripts / humans | `node bin/latex2pdf.mjs -i in.tex -o out.pdf` |
| Local web UI | Human (editor left, PDF preview right) | `node bin/latex2pdf-ui.mjs` |

## Technology decisions

| Concern | Choice | Why | Rejected |
| --- | --- | --- | --- |
| TeX engine | [Tectonic](https://github.com/tectonic-typesetting/tectonic) 0.17.0 (MIT, XeTeX based) | Single self-contained binary, no TeX Live (4+ GB), never prompts, shell-escape off by default, reproducible bundles, local package cache | TeX Live/MacTeX (huge), `brew install tectonic` (22 deps, upgrades shared libs), WASM engines (slow, immature package coverage) |
| Backend | Node.js >= 22, ESM, **zero runtime dependencies** | Smallest supply-chain surface; `node:http`, `node:test`, `node:child_process` are enough | Express/Fastify (extra deps not needed) |
| Frontend | Vite + React 19 + TypeScript, Vitest + Testing Library | Requested React; fast build; static output served by the backend | Next.js (needless server) |
| Packaging | Folder: Node SEA launcher + `web/` + `bin/tectonic` + cache | Portable, no Node install needed on target | Electron (150 MB+), Tauri (needs Rust toolchain) |

Engine binary is downloaded from the official GitHub release by `scripts/install-engine.mjs`, pinned by version and **SHA-256 verified** before extraction. Binary lives in `vendor/` (git-ignored).

## Module map

```
bin/latex2pdf.mjs        CLI (thin: calls src/cli.mjs runCli)
bin/latex2pdf-ui.mjs     starts the local server, opens the browser (`--no-open` to skip)
src/index.mjs            public API surface (re-exports + shared default compiler)
src/cli.mjs              arg parsing, exit codes, JSON output (testable: runCli(argv, io))
src/config.mjs           env -> validated frozen config object (12-factor)
src/errors.mjs           LatexToPdfError with stable machine codes
src/input.mjs            normalize + classify input (latex | fragment | text), wrap into a document
src/compat.mjs           strips pdfTeX-only directives (\pdfgentounicode, glyphtounicode...) that break XeTeX
src/validate.mjs         static policy scan of LaTeX source (forbidden primitives, path escapes)
src/engine.mjs           resolve tectonic, run it in an isolated temp dir with limits, engineInfo()
src/compile.mjs          createCompiler(config): validate -> compat -> engine -> result; compileToFile
src/limiter.mjs          non-blocking concurrency limiter
src/pdf.mjs              countPages() (handles compressed object streams)
src/installer.mjs        pinned engine asset table + sha256 check (used by scripts/install-engine.mjs)
src/sandbox.mjs          macOS Seatbelt (sandbox-exec) wrapper: no reads of /Users etc. except work/cache/engine dirs, writes only in work/cache
src/server/app.mjs       createApp (routes, host/origin checks, rate limit, headers) + listen with port fallback
src/server/security.mjs  CSP + headers, host/origin allowlists
src/server/rate-limit.mjs token bucket per IP, bounded memory
src/server/body.mjs      streaming body reader with byte cap
src/server/static.mjs    safe static files for web/dist (traversal + symlink escape protected)
src/server/index.mjs     startServer(), browserCommand()
scripts/                 install-engine, warmup (prime package cache), [planned] build-portable
web/                     React app (Vite + TS); `npm run build:web` -> web/dist, served by the server
test/unit, test/integration, test/helpers (fake engine)
examples/resume.tex      known-good sample (XeTeX compatible)
handoff/                 this folder
```

## Data flow

```
 source (string|file) -> input.normalize -> compat.applyCompat -> validate.assertSafe -> engine.run (temp dir,
 scrubbed env, --untrusted, timeout, size caps) -> PDF bytes -> (CLI: atomic write to --output) | (HTTP: application/pdf)
```

Validation runs on the text that is actually compiled (after compat), never on a different version.

## Public contract (what agents rely on)

`compile({ source, mode?, timeoutMs?, signal? }) -> Promise<{ pdf: Buffer, kind, pages, warnings: string[], durationMs }>`

`compileToFile({ input?: path, source?: string, output: path, mode?, mkdir?, timeoutMs? }) -> Promise<{ outputPath, bytes, pages, durationMs, warnings, kind }>` (exactly one of `input`/`source`)

`mode`: `auto` (default; detects full document vs fragment vs plain text), `latex`, `fragment`, `text`.

Errors are `LatexToPdfError` with `.code` in: `CONFIG_INVALID`, `INPUT_EMPTY`, `INPUT_TOO_LARGE`, `INPUT_INVALID`, `POLICY_VIOLATION`, `ENGINE_NOT_FOUND`, `COMPILE_FAILED`, `TIMEOUT`, `OUTPUT_TOO_LARGE`, `OUTPUT_PATH_INVALID`, `BUSY`.

CLI exit codes: `0` ok, `1` unexpected, `2` bad usage/input/output path/config, `3` policy violation, `4` compile failed or output too large (log on stderr), `5` timeout, `6` engine missing, `7` busy.

CLI `--json` prints one JSON object to stdout: `{ ok, outputPath?, bytes?, pages?, durationMs?, warnings?, error?: { code, message, log? } }`. `--check` verifies the engine. `-i -` reads stdin.

## HTTP API (local UI backend)

- `GET /api/health` -> `{ ok, engine: { found, version } }` (cached 30 s, no paths)
- `POST /api/compile` body `application/json {"source": "...", "mode": "auto"}` or `text/plain`/`application/x-tex` raw body -> `200 application/pdf` (headers `X-Latex2pdf-Pages`, `X-Latex2pdf-Duration-Ms`) or JSON `{ error: { code, message, log? } }`. Status map: `INPUT_EMPTY`/`INPUT_INVALID` 400, `INPUT_TOO_LARGE` 413, unsupported content type 415, `POLICY_VIOLATION`/`COMPILE_FAILED`/`OUTPUT_TOO_LARGE` 422, rate limit 429, `BUSY`/`ENGINE_NOT_FOUND` 503 (BUSY has Retry-After), `TIMEOUT` 504, forbidden Host/Origin 403, unexpected 500 (`INTERNAL`, generic message). Client disconnect aborts the compile.
- everything else: static files from `web/dist` (SPA fallback to `index.html` for extensionless paths; 503 with a hint if not built), GET/HEAD only, other methods 405.

Default bind `127.0.0.1:5757` (falls back to a free port if busy and `LATEX2PDF_PORT` is unset).

## Configuration (env vars, all optional)

| Var | Default | Meaning |
| --- | --- | --- |
| `LATEX2PDF_PORT` | `5757` | UI server port |
| `LATEX2PDF_HOST` | `127.0.0.1` | Bind address. Non-loopback needs `LATEX2PDF_ALLOW_REMOTE=1` |
| `LATEX2PDF_MAX_INPUT_BYTES` | `1048576` | Max LaTeX source size |
| `LATEX2PDF_MAX_OUTPUT_BYTES` | `26214400` | Max PDF size |
| `LATEX2PDF_TIMEOUT_MS` | `60000` | Hard compile timeout |
| `LATEX2PDF_MAX_CONCURRENCY` | `2` | Parallel compiles, extra requests get `BUSY`/503 |
| `LATEX2PDF_RATE_LIMIT_PER_MIN` | `60` | Per-IP HTTP rate limit |
| `LATEX2PDF_ENGINE` | auto | Absolute path to a tectonic binary (overrides vendor/PATH) |
| `LATEX2PDF_OFFLINE` | `0` | `1` = tectonic `--only-cached` (no network) and sandbox denies network |
| `LATEX2PDF_SANDBOX` | `auto` | `auto` use OS sandbox if available (macOS only today), `on` require it, `off` disable |
| `LATEX2PDF_ALLOWED_HOSTS` | empty | Extra Host header names (comma list) when remote access is enabled |
| `TECTONIC_CACHE_DIR` | `<repo>/vendor/tectonic-cache` | Package cache (portable) |

## Constraints worth remembering

- First compile of a new package needs network (Tectonic fetches from its bundle) unless the cache was primed (`npm run warmup`) and `LATEX2PDF_OFFLINE=1`.
- XeTeX engine: use `fontspec`/system-independent fonts shipped in the bundle; `pdflatex`-only quirks may differ.
- Source of PDF is always a fresh temp dir; nothing from the caller's cwd is visible to the engine.
- Tectonic is XeTeX: pdfTeX-only primitives are undefined. `src/compat.mjs` removes the common whole-line ones and reports them as `compat:` warnings. Extend its RULES list when a new template breaks.
- Measured (Apple Silicon): cold first compile ~11 s (package download), warm resume compile ~0.6 s. Engine binary ~54 MB, package cache ~45 MB after `npm run warmup`.
- `tectonic --untrusted` blocks shell escape but still allows `\input` of absolute paths (verified). `src/validate.mjs` is therefore the primary file-read barrier.

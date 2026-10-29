# Architecture (source of truth)

If code and this file disagree, fix one of them in the same commit. Last verified: 2026-10-28 (M0 planning; see PROGRESS.md for what is actually built).

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
bin/latex2pdf.mjs        CLI (thin: parse args -> core -> exit code)
bin/latex2pdf-ui.mjs     starts the local server, opens the browser
src/index.mjs            public API surface (re-exports)
src/config.mjs           env -> validated config object (12-factor)
src/errors.mjs           typed errors with stable machine codes
src/input.mjs            normalize + classify input (latex | fragment | text), wrap into a document
src/validate.mjs         static policy checks on LaTeX source (size, NUL, forbidden primitives)
src/engine.mjs           locate tectonic, run it in an isolated temp dir with limits
src/compile.mjs          orchestration: validate -> normalize -> engine -> PDF buffer / file
src/server/*.mjs         http server, security headers, rate limit, host/origin checks, static files
scripts/                 install-engine, warmup (prime package cache), build-portable
web/                     React app (built to web/dist, served by the server)
test/unit, test/integration
handoff/                 this folder
```

## Data flow

```
 source (string|file) -> input.normalize -> validate.assertSafe -> engine.run (temp dir, scrubbed env,
 timeout, size caps) -> PDF bytes -> (CLI: atomic write to --output) | (HTTP: application/pdf response)
```

## Public contract (what agents rely on)

`compile({ source, mode?, timeoutMs? }) -> Promise<{ pdf: Buffer, warnings: string[], durationMs: number }>`

`compileToFile({ input?: path, source?: string, output: path, mode?, timeoutMs? }) -> Promise<{ outputPath, bytes, durationMs, warnings }>`

Errors are `LatexToPdfError` with `.code` in: `INPUT_EMPTY`, `INPUT_TOO_LARGE`, `INPUT_INVALID`, `POLICY_VIOLATION`, `ENGINE_NOT_FOUND`, `COMPILE_FAILED`, `TIMEOUT`, `OUTPUT_TOO_LARGE`, `OUTPUT_PATH_INVALID`, `BUSY`.

CLI exit codes: `0` ok, `2` bad usage/input, `3` policy violation, `4` compile failed (log on stderr), `5` timeout, `6` engine missing, `1` unexpected.

CLI `--json` prints one JSON object to stdout: `{ ok, outputPath?, bytes?, durationMs?, warnings?, error?: { code, message, log? } }`.

## HTTP API (local UI backend)

- `GET /api/health` -> `{ ok, engine: { found, version } }`
- `POST /api/compile` body `application/json {"source": "...", "mode": "auto"}` or `text/plain`/`application/x-tex` raw body -> `200 application/pdf` or JSON error `{ error: { code, message, log? } }` with 400/413/415/422/429/503/504.
- everything else: static files from `web/dist` (SPA fallback to `index.html`), GET/HEAD only.

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
| `LATEX2PDF_OFFLINE` | `0` | `1` = tectonic `--only-cached` (no network) |
| `TECTONIC_CACHE_DIR` | `<repo>/vendor/tectonic-cache` | Package cache (portable) |

## Constraints worth remembering

- First compile of a new package needs network (Tectonic fetches from its bundle) unless the cache was primed (`npm run warmup`) and `LATEX2PDF_OFFLINE=1`.
- XeTeX engine: use `fontspec`/system-independent fonts shipped in the bundle; `pdflatex`-only quirks may differ.
- Source of PDF is always a fresh temp dir; nothing from the caller's cwd is visible to the engine.

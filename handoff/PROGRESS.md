# Progress Log

Append-only milestone log. Newest at the bottom. Update after every milestone (and commit).

| # | Milestone | Status | Date |
| --- | --- | --- | --- |
| M0 | Scaffold, handoff docs, research, GitHub repo | done | 2026-10-28 |
| M1 | Core compiler + CLI + engine installer (TDD) | done | 2026-10-28 |
| M2 | Secure local HTTP server | done | 2026-10-28 |
| M3 | React UI (editor, drop zone, preview, download) | done | 2026-10-28 |
| M4 | Portable package + final README | done | 2026-10-28 |
| M5 | Public repo, CI, Docker, release pipeline, Pages | done | 2026-10-28 |
| M6 | Rename to ToolMaster; modular core + tools architecture | done | 2026-10-29 |
| M7 | LaTeX to DOCX tool, start menus (web + terminal), per-tool bundles | done | 2026-10-29 |
| M8 | Research; shared engine catalog, packs, isolated workers, MCP server | done | 2026-10-29 |
| M9 | New tools: PDF Pages, Doc to Markdown | done | 2026-10-29 |
| M10 | Packaging overhaul: lite bundles, compressed engines, dynamic release matrix, smoke tests, Docker from the lite bundle | done | 2026-10-29 |
| M11 | Docs, AGENTS.md, TOOLS.md, cleanup | done in repo; release dry run pending | 2026-10-29 |

Note: entries below dated 2026-10-28 describe the LatexToPDF layout (`src/`, `LATEX2PDF_*`, `/api/compile`); the code moved in M6, see the 2026-10-29 section for the current names.

## 2026-10-28 M0 research notes
- No LaTeX engine was installed. Chosen: Tectonic 0.17.0 standalone binary (MIT). `brew install tectonic` was declined because it pulls 20 new deps and upgrades `gettext`/`libunistring`.
- Official release asset for this Mac: `tectonic-0.17.0-aarch64-apple-darwin.tar.gz`, sha256 `a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667`.
- Security baseline: OWASP Top 10 + Cloudflare WAF/Managed-Rules concepts (body size limits, rate limiting, strict headers, deny-by-default) implemented in-process, see SECURITY_RULES.md.
- Design research: NN/g microinteractions, Material 3 structure/accessibility; see DESIGN_LANGUAGE.md.
- Repo: https://github.com/rajatgedam/LatexToPDF (private).

## 2026-10-28 M1 core + CLI
Built test-first: config, input, compat, validate, engine, limiter, pdf, compile, cli, installer. 87 unit tests (hermetic, fake engine in `test/helpers`) + 11 integration tests (real Tectonic). Coverage on `src/`: 98% lines, 91% branches (gate: 80%).
- Verified: example resume renders correctly (1 page). Cold compile ~11 s, warm ~0.6 s.
- Finding: `tectonic --untrusted` does NOT block absolute-path `\input` (it only warns). Added path-escape rules to `validate.mjs`; the policy scan is the main file-read barrier. See SECURITY_RULES R2.4.
- Finding: pdfTeX-only `\pdfgentounicode` / `\input{glyphtounicode}` (very common in resume templates) abort XeTeX; `compat.mjs` strips them and reports `compat:` warnings.
- Engine binary installed by `npm run install:engine` (sha256 pinned, verified); `npm run warmup` primes the package cache (45 MB).
- Tool lesson: terminal summaries of long hashes can be corrupted; write values to a file and read them back (a Windows digest was truncated once).

### Backlog / ideas
- Linux/Windows engine sandbox (bubblewrap / Landlock / AppContainer). macOS is done (see M2).
- `compat.mjs` is whole-line only; extend if a template needs inline fixes.

## 2026-10-28 M2 secure server
Tests first again: 126 unit + 27 integration tests now (153 total), coverage on `src/` 97.9% lines / 91% branches.
- `src/server/*`: `node:http` only. Host allowlist (DNS rebinding), Origin + `Sec-Fetch-Site` checks on non-GET (CSRF), no CORS ever, strict CSP and friends, per-IP token bucket (60/min), streaming body cap, content-type allowlist, generic 500s, client disconnect aborts the compile, static server with traversal and symlink-escape protection.
- `bin/latex2pdf-ui.mjs` starts the server and opens the browser (fixed argv, loopback-only URL check). Port 5757, falls back to a free port when busy and `LATEX2PDF_PORT` is unset.
- `src/sandbox.mjs`: macOS Seatbelt wrapper (default `auto`). Verified with the real engine: absolute-path read of a secret and of `~/.zshrc` fail, writes outside work dir blocked, cold-cache package download still works inside the sandbox.
- Fake-engine unit tests set `LATEX2PDF_SANDBOX=off` (the fake needs to read node from /Users). Real-engine tests run with the sandbox on by default.

## 2026-10-28 M3 React UI
Vite 8 + React 19 + TypeScript 7 + Vitest 5 in `web/` (0 npm audit findings). Tests first: 33 web tests, coverage 95.7% lines / 82% branches. Production build: JS 234 kB (74 kB gzip), CSS 10 kB.
- Features: left editor (line gutter, Tab inserts 2 spaces with an Esc escape hatch for keyboard users, Cmd/Ctrl+Enter), whole-pane file drop with animated overlay, Open file picker (.tex/.latex/.txt, 1 MiB), Load sample (imports `examples/resume.tex` via `?raw`), Clear, auto-compile toggle (900 ms debounce), right preview iframe (blob URL), Download PDF named after the source file, status pill, mascot Texy, CSS confetti, error log panel, footer with char count and engine status. Stale requests are aborted; blob URLs are revoked.
- Visual QA in the integrated browser: page loads under the strict CSP, compile works end to end, the blob PDF viewer loads in the iframe (`frame-src blob:` is sufficient), error state renders the sanitized log with the mascot. System dark mode was active during QA; the light palette has not been checked visually.
- Dev: `npm --prefix web run dev` (port 5173, proxies /api to 5757 and strips Origin so the CSRF check passes). Start the API with `node bin/latex2pdf-ui.mjs --no-open`.
- Known nit: the hidden file input shows up as an extra "Open a .tex or .txt file" button in the accessibility tree.

## 2026-10-28 M4 portable package + README
- `npm run package` (`scripts/build-portable.mjs`, helpers in `scripts/build-lib.mjs`, unit tested): esbuild bundles `src/portable-entry.mjs` to one CJS file, Node SEA blob injected with postject into a copy of the node binary (macOS: `lipo -thin` the universal node to the host arch, `codesign --remove-signature` before and ad-hoc `codesign --sign -` after). Output `dist/LatexToPDF-<platform>-<arch>/`: `latex2pdf` (111 MB, UI + CLI in one), `vendor/tectonic`, `vendor/tectonic-cache` (45 MB, omit with `--no-cache`), `web/dist`, `examples/`, launcher (`LatexToPDF.command` on macOS), `READ-ME-FIRST.txt`. Total about 207 MB. `--zip` makes a zip.
- The executable resolves everything relative to its own folder (`projectRoot = dirname(execPath)`), so the folder can be moved. No args or `ui` starts the web UI; any other args are the CLI (a leading `compile` is accepted).
- Verified from a copy in /tmp with a scrubbed environment (no Node on PATH): `--check`, offline compile of the example (0.4 s, sandbox on), UI serving + API compile. Gated integration test `test/integration/portable.test.mjs` covers this when a build exists.
- Shared `src/server/launch.mjs` now backs both `bin/latex2pdf-ui.mjs` and the portable entry. `config.mjs` falls back to cwd when `import.meta.url` is unavailable (bundle).
- Root `LatexToPDF.command` is a double-click launcher for a source checkout (runs `npm run setup` on first use).
- Light theme checked visually via Playwright color-scheme emulation: warm cream paper, coral primary, indigo ink; looks right.
- README rewritten: agent quickstart at the top, human run instructions at the bottom.
- Not done / honest limits: only macOS arm64 was built and run; Linux/Windows packaging is untested; no code signing or notarization (Gatekeeper may need `xattr -dr com.apple.quarantine`); no CI workflow; the repo is private.

## 2026-10-28 M5 public repo + universal distribution
- Repo made public after an audit (no secrets, no personal files; history has only the GitHub noreply email). Enabled secret scanning + push protection, Dependabot alerts/updates, private vulnerability reporting, read-only default workflow token, SHA-pinning required, fork-PR approval.
- Universal run options: (1) per-OS zips from GitHub Releases (darwin arm64/x64, linux x64/arm64, win32 x64) built by `release.yml`, (2) Docker image on GHCR (multi-arch), (3) source checkout. `build-portable.mjs` made cross-platform (postject via node, npm shell on Windows, tar zip on Windows).
- CI (`ci.yml`): ubuntu + macOS run web tests and the full backend suite with the 80% gate, `npm audit`, plus a Docker job that builds the image and smoke-tests it hardened (read-only, cap-drop ALL, non-root, Host check). First CI run also proved the backend suite passes on Linux.
- Bug found by CI: Tectonic panics at startup without a CA bundle (`No CA certificates were loaded`), even for cached compiles; `node:24-slim` has none. Fixed by installing `ca-certificates` in the image. `warmup.mjs` now exits non-zero on failure (it silently hid this during the image build).
- Pages: `site/` static landing page deployed by `pages.yml` to https://rajatgedam.github.io/LatexToPDF/. Deliberately NOT a hosted converter (see SECURITY_RULES R5.8).
- Release publishing is intentionally manual: push a `v*` tag. A manual run of `release.yml` only builds and smoke-tests (offline compile on each OS).
- GHCR packages start private even for public repos; after the first release flip the package to public in GitHub (Packages > latextopdf > settings). Not scriptable via the REST API.

### Ideas for next sessions
- GitHub Actions: unit + web tests on every push (integration needs the engine download).
- Linux sandbox via bubblewrap/Landlock; Windows AppContainer.
- Multi-file projects (zip with images/bib) with a validated, sandboxed extraction.
- Template gallery for the UI; PDF page thumbnails; export `.tex` back.

## 2026-10-29 M6/M7 ToolMaster: modular tools, LaTeX to DOCX, menus
- Rename: GitHub repo `ToolMaster`, folder `RGit/ToolMaster`, package `toolmaster`, `TOOLMASTER_*` env, `toolmaster` CLI, `X-ToolMaster-*` headers, images `ghcr.io/rajatgedam/toolmaster[-<tool>]`.
- Architecture: kernel in `core/` (config, errors, sdk, manifest, registry, runner, process, engines, installer, sandbox, cli, server, portable) and one folder per tool in `tools/<id>/`. Tools import only `core/sdk.mjs`; the core discovers tools at runtime (or gets a generated static list in the executable). The generic runner validates input/options/limits for every tool; `ctx.exec` is the single hardened path for external programs. The old engine code became `core/process.mjs` + `core/engines.mjs`; the LaTeX specifics moved to `tools/latex-to-pdf/`.
- New tool `latex-to-docx`: Pandoc 3.13 (`--sandbox`, GPL-2.0+ so downloaded/bundled as a separate program with THIRD-PARTY-NOTICES), options `mode` and `toc`, HTML preview (pandoc `-s --mathml`, CSP injected, shown in a `sandbox=""` iframe). Verified on the user's real resume: PDF 1 page, DOCX converts structure (bullets, links, headings); layout macros are dropped, as expected.
- Menus: web start menu (search, category sections, cards with readiness and install hint, `/` and `1-9` keys) and an interactive terminal menu (`toolmaster` without arguments; choose a tool, answer prompts for input, output and options; install/repair engines).
- Web: generic `Home` + `Workbench` driven by `GET /api/tools` (options bar from the manifest, text editor or binary file pane, `file`/`html`/`none` previews, hash routing). 56 web tests, 95% line coverage.
- Per-tool downloads: `npm run package -- --tools <ids>` (generated bundle entry imports only those tools; only their engines and caches are copied), release workflow builds `all`, `latex-to-pdf`, `latex-to-docx` for 5 OS targets with an offline smoke test per bundle, Docker `ARG TOOLS` (+ CI proves a one-tool image lists exactly one tool). Measured macOS arm64 zips: all 107 MB, docx 76 MB, pdf 66 MB (launcher 111 MB, Pandoc ~190 MB unpacked).
- Tests: 190 unit + integration for both tools, server, sandbox (incl. Pandoc blocked by the OS sandbox alone) and bundles.
- Findings: the terminal menu looped forever on EOF because `readline` yields `null`, not `undefined` (fixed + test); pandoc fails on unbalanced LaTeX with a readable message (surfaced as TOOL_FAILED); plain `--wrap=none` Pandoc fragments omit `\maketitle` data, so the preview uses `-s`; jsdom `Blob` in `new Response()` stringifies to `[object Blob]`.
- Release dry run (manual `release.yml`, run 40951181271): all 5 OS builds x 3 bundles plus offline smoke tests passed; Docker and publish jobs skipped as designed (tag-only). The first dry run failed on Windows because Git Bash's GNU `tar` cannot zip (`D:` read as a host); `build-portable.mjs` now zips with PowerShell `Compress-Archive` there.
- Not done: Linux/Windows OS sandbox; no shared engine-spec registry (a second Pandoc-based tool would duplicate the spec); releases still unpublished (tag `v0.2.0` when ready).

## 2026-10-29 M8-M11 overhaul (v0.3.0): scale to many tools, agent access, two new tools
Research, sources and measurements are in `RESEARCH.md`. Summary of what changed and why:
- **Engine catalog** (`engines/<id>.mjs`, manifests name engines by id, `core/engine-catalog.mjs`): fixes the 'second Pandoc tool duplicates the spec' backlog item; one download, pack and licence line per engine.
- **Packs** (`core/pack.mjs`): Brotli container with per-file SHA-256, traversal checks, atomic unpack, stamp-based refresh. Engines/caches ship as `vendor/<id>.pack` and unpack on first use. Measured: Pandoc 186.3 -> 23.9 MB, Tectonic 51.5 -> 13.3 MB, Tectonic cache 44.1 -> 5.7 MB (Brotli 11; gzip-9 gave 41.1 / 20.6 / 10.6, zstd-19 26.3 / 14.7 / 6.1). `status()` reports packed engines as found without unpacking.
- **Isolated workers** (`ctx.isolate`, `core/worker*.mjs`): JavaScript parsers of untrusted files run in a sandboxed copy of the same program through `runProcess` (heap limit, no network, scrubbed env, kill on timeout, macOS Seatbelt). Needed a new sandbox concept: read-only folders (`ro`) plus metadata-only access to their ancestors, because Node `lstat`s every path component. `process.mjs` gained `optional` outputs so a worker can report a structured error without producing its file. Verified by a hostile-worker integration test.
- **MCP server** (`core/mcp.mjs`, `toolmaster mcp`, `.vscode/mcp.json`): tools generated from manifests; typed schemas; inline text results; confined file roots; cancellation. `-o -` (stdout) and `help <tool> --json` added for plain CLI agents. `AGENTS.md` and the generated `TOOLS.md` (drift test) tell agents which tool to use instead of writing a script.
- **Manifest additions**: `string` options (`maxLength`, `help`), `preview: "text"`, `useWhen`, engine ids. Web UI: text input control, text preview with Copy (62 web tests).
- **Tools**: `pdf-pages` (`@cantoo/pdf-lib` 2.11.1; grammar `3`, `2-5`, `5-2`, `r1`, `end`, `odd`, `even`, `all`, `!x`; rotate) and `doc-to-markdown` (Pandoc 3.13 reads docx, pptx, xlsx, odt, epub, html, rtf, csv, tsv, latex, ipynb with no new engine; `pdfjs-dist` 6.4.299 for PDFs inside a worker; byte sniffing; page markers; scanned-PDF warning). Real-engine tests build office files with Pandoc and read them back.
- **Packaging**: `--runtime sea|node` (lite), `--engines bundled|download`, `--pack-quality`, `--out`; notices now list bundled JavaScript packages with licence texts (esbuild metafile). `pdf-pages` lite zip is 0.36 MB; everything (4 tools) as a single executable is 78.7 MB zipped / 156.7 MB unpacked (was 107 / 394 MB with 2 tools). A full Brotli-11 build takes about 9.5 minutes.
- **CI/release**: `scripts/plan-lib.mjs` builds the matrix from the tools folder, `scripts/smoke-bundle.mjs` (every tool + MCP, offline) and `scripts/smoke-http.mjs` (Docker) fail when a tool has no case. Dockerfile builds the lite bundle (no node_modules in the image). Not run yet: the new workflows on GitHub and the Docker build (no Docker daemon locally).
- **Findings**: Seatbelt blocks Node's `lstat` of parent folders unless they get `file-read-metadata`; `fetch` ignores a custom `Host` header (use `node:http` to test Host checks); pdf-lib's `load` rewrites the Producer unless `updateMetadata: false`; a corrupt PDF can load and then fail at `getPageCount`, so both belong in one try block; pdfjs needs `globalThis.pdfjsWorker` to run inside a bundle; `--test-coverage` must not be run while a long packaging job competes for CPU if you care about timing.
- **Cleanup**: removed `scripts/prune-tools.mjs` (Docker no longer prunes), the stale `vendor/tectonic-cache`, `dist/` build output and stray draft files.
- Tests: 329 backend (99.3% line coverage) + 62 web, all green locally.
- Backlog: OCR for scanned PDFs (an optional engine, e.g. Tesseract, would be a new catalog entry); a `merge` mode for pdf-pages; Linux/Windows OS sandbox (bubblewrap/Landlock, AppContainer); code signing; evaluating `zstd` packs when Node marks them stable; per-engine pack cache to avoid re-packing Pandoc for each bundle build; HTTP transport for MCP.

## 2026-10-30 LaTeX to DOCX preview fix, release dry run
- **Bug**: the HTML preview of LaTeX to DOCX looked blank (found while converting a real resume). Cause: the preview page is a blob URL in a sandboxed iframe, and blob pages **inherit the app's CSP**. Pandoc's standalone page carries an inline `<style>` that `style-src 'self'` blocked, so the browser fell back to its default light text (dark-mode scheme inherited from the app) on the white frame: invisible text. The server and the DOCX were always fine.
- **Fix** (no CSP loosening): `lockDown()` in `tools/latex-to-docx/preview.mjs` drops the blocked `<style>`, adds `<meta name="color-scheme" content="light">` and sets `bgcolor`/`text`/`link` on `<body>` (plain attributes are not CSP-controlled); `.stage__frame` has `color-scheme: light`. The preview is now an intentionally plain approximation; the DOCX is the real output. Rule recorded in SECURITY_RULES R4.6. Verified in a real browser (headings, list, table, MathML formula visible). Tests: 4 unit tests for `lockDown`.
- **Finding**: a screenshot of the result pane, not DOM/accessibility snapshots, is what finds this class of bug (the DOM was complete).
- Services were stopped after verification (UI server on port 5757 no longer running).

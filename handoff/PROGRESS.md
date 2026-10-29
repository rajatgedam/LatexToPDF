# Progress Log

Append-only milestone log. Newest at the bottom. Update after every milestone (and commit).

| # | Milestone | Status | Date |
| --- | --- | --- | --- |
| M0 | Scaffold, handoff docs, research, GitHub repo | done | 2026-10-28 |
| M1 | Core compiler + CLI + engine installer (TDD) | done | 2026-10-28 |
| M2 | Secure local HTTP server | done | 2026-10-28 |
| M3 | React UI (editor, drop zone, preview, download) | done | 2026-10-28 |
| M4 | Portable package + final README | done | 2026-10-28 |

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

### Ideas for next sessions
- GitHub Actions: unit + web tests on every push (integration needs the engine download).
- Linux sandbox via bubblewrap/Landlock; Windows AppContainer.
- Multi-file projects (zip with images/bib) with a validated, sandboxed extraction.
- Template gallery for the UI; PDF page thumbnails; export `.tex` back.

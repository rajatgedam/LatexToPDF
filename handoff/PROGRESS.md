# Progress Log

Append-only milestone log. Newest at the bottom. Update after every milestone (and commit).

| # | Milestone | Status | Date |
| --- | --- | --- | --- |
| M0 | Scaffold, handoff docs, research, GitHub repo | done | 2026-10-28 |
| M1 | Core compiler + CLI + engine installer (TDD) | done | 2026-10-28 |
| M2 | Secure local HTTP server | done | 2026-10-28 |
| M3 | React UI (editor, drop zone, preview, download) | todo | |
| M4 | Portable package + final README | todo | |

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

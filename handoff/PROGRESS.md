# Progress Log

Append-only milestone log. Newest at the bottom. Update after every milestone (and commit).

| # | Milestone | Status | Date |
| --- | --- | --- | --- |
| M0 | Scaffold, handoff docs, research, GitHub repo | done | 2026-10-28 |
| M1 | Core compiler + CLI + engine installer (TDD) | done | 2026-10-28 |
| M2 | Secure local HTTP server | todo | |
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
- OS-level sandbox for the engine (macOS `sandbox-exec` deny file-read outside work/cache dir; Linux bubblewrap/landlock) as defense in depth for R3. Planned for M2.
- `compat.mjs` is whole-line only; extend if a template needs inline fixes.

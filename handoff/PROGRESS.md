# Progress Log

Append-only milestone log. Newest at the bottom. Update after every milestone (and commit).

| # | Milestone | Status | Date |
| --- | --- | --- | --- |
| M0 | Scaffold, handoff docs, research, GitHub repo | in progress | 2026-10-28 |
| M1 | Core compiler + CLI + engine installer (TDD) | todo | |
| M2 | Secure local HTTP server | todo | |
| M3 | React UI (editor, drop zone, preview, download) | todo | |
| M4 | Portable package + final README | todo | |

## 2026-10-28 M0 research notes
- No LaTeX engine was installed. Chosen: Tectonic 0.17.0 standalone binary (MIT). `brew install tectonic` was declined because it pulls 20 new deps and upgrades `gettext`/`libunistring`.
- Official release asset for this Mac: `tectonic-0.17.0-aarch64-apple-darwin.tar.gz`, sha256 `a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667`.
- Security baseline: OWASP Top 10 + Cloudflare WAF/Managed-Rules concepts (body size limits, rate limiting, strict headers, deny-by-default) implemented in-process, see SECURITY_RULES.md.
- Design research: NN/g microinteractions, Material 3 structure/accessibility; see DESIGN_LANGUAGE.md.

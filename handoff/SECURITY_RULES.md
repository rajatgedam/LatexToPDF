# Security Rules

Baseline: OWASP Top 10 + Cloudflare application-security practices (managed-rules / OWASP Core thinking: validate at the edge, deny by default, limit body size, rate limit, strict headers, least privilege, no information leakage). ToolMaster has no Cloudflare in front of it because it is local-only, so the same controls are enforced in-process.

These are rules, not suggestions. Every rule has a test. Do not weaken one without recording the reason in PROGRESS.md. Rules marked **[core]** apply to every tool automatically; rules marked **[tool]** must be satisfied by each tool author.

## R1 Network exposure [core]
- R1.1 Bind to `127.0.0.1` by default. Binding elsewhere requires `TOOLMASTER_ALLOW_REMOTE=1` and prints a warning.
- R1.2 Validate the `Host` header against an allowlist (`localhost`, `127.0.0.1`, `[::1]` + the bound port, plus `TOOLMASTER_ALLOWED_HOSTS`) to defeat DNS rebinding.
- R1.3 For non-GET requests, if an `Origin` header is present it must match the allowed host list, and `Sec-Fetch-Site: cross-site` is refused (CSRF / drive-by from a web page). No CORS headers are ever emitted.
- R1.4 Only `GET`, `HEAD`, and `POST` on `/api/tools/:id/(run|preview)` are allowed; others get 405.

## R2 Input handling (deny by default)
- R2.1 [core] Hard max input size (default 1 MiB, or the manifest's `input.maxBytes`), enforced while streaming the body, not after.
- R2.2 [core] Content-Type allowlist per tool kind: text tools `application/json` or `text/*`/`application/x-tex`; binary tools `application/octet-stream`; else 415.
- R2.3 [core] Reject NUL bytes, invalid UTF-8 and wrong input types; unknown or invalid tool options are `INPUT_INVALID`.
- R2.4 [core] Output path (CLI/API) must end in the tool's output extension, resolve to a regular file location (not a directory, not a symlink), parent directory must exist (or `mkdir: true`), written atomically (temp + rename).
- R2.5 [tool: latex-to-pdf] Static policy scan (`tools/latex-to-pdf/validate.mjs`) rejects primitives that touch files, processes or the network: `\write`/`\write18`, `\immediate`, `\openout`, `\openin`, `\read`, `\input` unless the argument is a bare name (`[A-Za-z0-9_-]+`, needed for `glyphtounicode`), `\include`, `\InputIfFileExists`, `\csname`, `\catcode`, `\scantokens`, `\directlua`, `\special`, `filecontents`, verbatim/listing file inputs, dangerous packages (`shellesc`, `minted`, `catchfile`, ...), and path-escaping arguments (`/abs`, `..`, `~`, `\`, `:`) to `\includegraphics`, `\graphicspath`, `\usepackage`, `\documentclass`, `\XeTeXpicfile`. **Finding (2026-10-28): `tectonic --untrusted` still allows `\input{/absolute/path}`, so this scan is the primary file-read barrier outside macOS.** Keep the list authoritative and add a test for every new rule.
- R2.6 [tool: latex-to-docx] Always run Pandoc with `--sandbox` (no file, network or process access from the document). Plain-text mode uses `markdown-raw_html-raw_tex` so input cannot smuggle raw HTML/TeX. Integration tests prove `\input`/`\include`/`\verbatiminput`/`\lstinputlisting` of a secret file never reach the output.
- R2.7 [tool] A tool validates its own format; anything that can read files, run programs or reach the network from inside a document must be blocked by the engine's own sandbox flag and/or a policy scan, and have a test.

## R3 Engine isolation (assume tool-level checks can be bypassed) [core]
- R3.1 Engines run only through `ctx.exec` -> `core/process.mjs`: `spawn` with an argument array (no shell), never interpolating user data into arguments. File names for inputs/outputs must match `[A-Za-z0-9._-]+`.
- R3.2 Fresh `fs.mkdtemp` directory (mode 0700) per run, deleted in `finally`; the engine cwd is that directory only; input files are written `wx`, mode 0600.
- R3.3 Scrubbed environment: minimal `PATH`, `HOME`, `LANG`, `TMPDIR` (the work dir) plus only the variables the tool passes explicitly (e.g. `TECTONIC_CACHE_DIR`). No inherited secrets (`GITHUB_TOKEN`, cloud keys, ...).
- R3.4 Wall-clock timeout with SIGKILL of the whole process group; abort signal support (client disconnect); stdout/stderr capture capped; output file size cap.
- R3.5 Concurrency limit; overflow returns `BUSY` immediately (no unbounded queue = no memory DoS).
- R3.6 `TOOLMASTER_OFFLINE=1` lets tools forbid network use (Tectonic `--only-cached`); tools pass `network: false` whenever their engine needs no network (Pandoc), which the macOS sandbox enforces.
- R3.7 [tool: latex-to-pdf] Always pass `--untrusted`, never `-Z shell-escape`. An integration test proves `\write18` does not execute even with the policy scan bypassed.
- R3.8 OS sandbox (`core/sandbox.mjs`, macOS `sandbox-exec`, default `auto`): an engine cannot read `/Users`, `/Volumes`, `/private/tmp`, `/private/var/folders` except its work dir, declared read-write dirs (caches) and its own binary dir, and cannot write outside work dir/cache dirs. Paths are passed as `-D` params, never interpolated into the profile. Integration tests prove an absolute `\input` of a secret fails even with the policy scan bypassed, and that Pandoc is blocked by the OS sandbox alone. **Linux/Windows have no sandbox yet** (backlog: bubblewrap/Landlock, AppContainer); there tool-level controls (R2.5, R2.6) are the only file-read barrier.

## R4 HTTP hardening [core]
- R4.1 Security headers on every response: `Content-Security-Policy` (`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy` (deny camera/mic/geo/payment/usb), `Cache-Control: no-store` on API.
- R4.2 Per-IP token bucket rate limit (default 60/min) -> 429 + `Retry-After`.
- R4.3 Header size and request/headers timeouts bounded; short keep-alive timeout.
- R4.4 Static file serving resolves paths under `web/dist` only; reject `..`, encoded traversal, NUL, backslashes, symlinks escaping root.
- R4.5 Errors never expose stack traces, absolute paths or env values; unexpected errors are a generic 500. Engine logs have the temp dir replaced with `<work>` and the home dir with `~`. The catalog (`/api/tools`) omits engine download details and paths.
- R4.6 Previews: `preview: "file"` shows the output in a blob iframe; `preview: "html"` pages must carry their own locked-down CSP (`default-src 'none'; img-src data:`) and are shown in an iframe with `sandbox=""` (no scripts, no same-origin). A tool must never return preview HTML that needs scripts or remote resources.

## R5 Supply chain
- R5.1 Backend has zero runtime npm dependencies (keep it that way unless justified). Build tools (esbuild, postject) are dev-only.
- R5.2 Every engine is pinned by version and verified by SHA-256 **before extraction**; mismatch aborts. Engine specs are validated at load (https URLs, 64-hex digests). Digests come from release metadata written to a file and read back, never from copied or summarized output.
- R5.3 Frontend dependencies are pinned by lockfile; `npm audit --omit=dev` in root and `web/` before release; fix high/critical.
- R5.4 No remote scripts/fonts/CDNs in the UI (CSP would block them anyway).
- R5.5 Secrets: none are needed. Never commit `.env`. GitHub token stays in the OS keyring (gh CLI).
- R5.6 CI/CD (public repo): every GitHub Action is first-party and pinned to a commit SHA (repo setting `sha_pinning_required` is on); workflows default to `contents: read` and elevate per job only (`contents: write`, `packages: write`, `id-token`/`attestations: write` only in release jobs); default workflow token is read-only and cannot approve PRs; fork PR workflows need approval; `persist-credentials: false` on checkout; no `pull_request_target`; releases are only published from `v*` tags and carry SHA256SUMS plus build-provenance attestations; Dependabot updates actions, npm and Docker; secret scanning + push protection, Dependabot alerts and private vulnerability reporting are enabled.
- R5.7 Docker: base image pinned by digest, non-root user, CA bundle only, no secrets in layers; recommended run flags `-p 127.0.0.1:5757:5757 --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges`. CI smoke-tests exactly this, for the full image and a one-tool image.
- R5.8 Never host a public conversion service: documents are code (LaTeX can read files and run programs). Pages hosts only a static landing page (`site/`, no JS, CSP meta).
- R5.9 Licences: Pandoc is GPL-2.0-or-later and is only downloaded or shipped as a separate unmodified program with `THIRD-PARTY-NOTICES.txt` stating the source location. Do not link or vendor GPL code into the MIT core.

## R6 Privacy
- R6.1 No telemetry, no analytics, no outbound calls except engine package/asset downloads the user asked for (`toolmaster install`, Tectonic package fetch when not offline).
- R6.2 Inputs and outputs are never logged; logs carry sizes, durations and error codes only.
- R6.3 Temp files are deleted after each run; the web app keeps results only as in-memory blob URLs (revoked on replace/unmount).

## Verification checklist (run before each release)
1. `npm test`, `npm run coverage` (>= 80 % lines on `core/` and `tools/`) and `npm --prefix web run coverage` green.
2. `npm audit --omit=dev` in root and `web/` shows no high/critical.
3. Manual: `curl -H 'Host: evil.test' http://127.0.0.1:5757/api/health` returns 403.
4. Manual: `toolmaster latex-to-pdf` on a document with `\immediate\write18{touch /tmp/pwned}` exits 3 and the file does not exist.
5. Manual: `toolmaster latex-to-docx` on `\input{/etc/hosts}` never shows the file's content (see the integration test).
